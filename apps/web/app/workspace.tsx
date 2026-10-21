'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { statusLabels, type Actor, globalRoles, roles, formatTarget } from '@kpi/shared';
import { calculate, comparableMetrics } from '@kpi/kpi-engine';
type Row = Record<string, any>; // Boundary records are validated by the API; UI accepts heterogeneous admin resources.
const labels: Record<string, string> = {
  dashboard: 'ภาพรวมโรงพยาบาล',
  departments: 'กลุ่มงาน',
  kpis: 'ตัวชี้วัด',
  entry: 'กรอกข้อมูล',
  approvals: 'การอนุมัติ',
  alerts: 'แจ้งเตือน',
  import: 'นำเข้าข้อมูล',
  reports: 'รายงาน',
  wallboard: 'ศูนย์ติดตามคุณภาพ',
  users: 'จัดการผู้ใช้งาน',
  sources: 'แหล่งข้อมูลและการเชื่อมต่อ',
  audit: 'ประวัติการใช้งาน',
  system: 'สถานะระบบ',
  settings: 'ตั้งค่าองค์กร',
};
async function api(path: string, body?: unknown, method = 'POST') {
  const r = await fetch('/api/' + path, {
    ...(body !== undefined
      ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
    cache: 'no-store',
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? 'ไม่สามารถโหลดข้อมูลได้');
  return data;
}
function Field({
  name,
  label,
  defaultValue,
  type = 'text',
  required = true,
}: {
  name: string;
  label: string;
  defaultValue?: string | number;
  type?: string;
  required?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        step={type === 'number' ? 'any' : undefined}
      />
    </label>
  );
}
function Badge({ status }: { status: string }) {
  return (
    <span className={'badge ' + status}>
      {statusLabels[status as keyof typeof statusLabels] ?? status}
    </span>
  );
}
function Chart({ data }: { data: Row[] }) {
  if (!data.some((row) => row.achievement != null))
    return <p className="empty">ยังไม่มีข้อมูลตัวชี้วัดในช่วงเวลานี้</p>;
  return (
    <div className="chart" aria-label="กราฟแนวโน้ม">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="4 4" vertical={false} />
          <XAxis dataKey="period" tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Line
            dataKey="achievement"
            name="ร้อยละผ่านเป้า"
            stroke="#148b84"
            strokeWidth={3}
            dot={{ r: 3 }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <details>
        <summary>ดูข้อมูลกราฟแบบตาราง</summary>
        <table>
          <tbody>
            {data.map((r) => (
              <tr key={r.period}>
                <td>{r.period}</td>
                <td>{r.achievement ?? 'ไม่มีข้อมูล'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
export default function Workspace({
  user,
  organization,
  timezone,
  refresh,
}: {
  user: Actor & { displayName: string };
  organization: string;
  timezone: string;
  refresh: number;
}) {
  const path = usePathname().split('/').filter(Boolean);
  const section = path[0] ?? 'dashboard';
  const admin = section === 'admin';
  const mode = admin ? path[1] : section;
  const id = admin ? path[2] : path[1];
  const wall = mode === 'wallboard';
  const [now, setNow] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sources, setSources] = useState<Row[]>([]);
  const [detailPeriod, setDetailPeriod] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('');
  const requestSequence = useRef(0);
  const [data, setData] = useState<Row | null>(null),
    [rows, setRows] = useState<Row[]>([]),
    [departments, setDepartments] = useState<Row[]>([]),
    [kpis, setKpis] = useState<Row[]>([]),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<Row | null>(null),
    [preview, setPreview] = useState<Row[] | null>(null),
    [csv, setCsv] = useState('');
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7)),
    [department, setDepartment] = useState(''),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [sort, setSort] = useState('asc'),
    [page, setPage] = useState(1),
    [selectedKpi, setSelectedKpi] = useState(''),
    [numerator, setNumerator] = useState(''),
    [denominator, setDenominator] = useState(''),
    [direct, setDirect] = useState('');
  const global = globalRoles.includes(user.role),
    superAdmin = user.role === 'SUPER_ADMIN',
    manager = ['SUPER_ADMIN', 'QUALITY_ADMIN', 'DEPARTMENT_ADMIN'].includes(user.role),
    entry = ['SUPER_ADMIN', 'DEPARTMENT_ADMIN', 'DATA_ENTRY'].includes(user.role),
    approver = ['SUPER_ADMIN', 'DEPARTMENT_ADMIN'].includes(user.role);
  const query = new URLSearchParams({
    period,
    page: String(page),
    search,
    status,
    sort,
    ...((mode === 'departments' && id) || department
      ? { departmentId: mode === 'departments' && id ? id! : department }
      : {}),
  }).toString();
  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    const read = async (path: string) => {
      const result = await api(path);
      if (sequence !== requestSequence.current) throw new Error('Stale response');
      return result;
    };
    setNow(Date.now());
    setError('');
    setLoading(true);
    try {
      const ds = await read('departments');
      setDepartments(ds);
      if (['dashboard', 'wallboard', 'reports'].includes(mode) || (mode === 'departments' && id)) {
        setData(await read('dashboard?' + query));
      } else if (mode === 'kpis' && !admin && id) {
        setData(await read('kpis/' + id));
      } else if (mode === 'kpis' && !admin) {
        const result = await read('kpis?' + query);
        setRows(result.items);
        setData(result);
      } else if (mode === 'departments' && !admin) {
        setRows(ds);
      } else if (mode === 'entry' || mode === 'approvals') {
        const [s, k] = await Promise.all([read('submissions'), read('kpis')]);
        setRows(s);
        setKpis(k.items);
      } else if (admin && mode === 'kpis') {
        setSources(await read('source-options'));
        const k = await read('kpis?' + query);
        setRows(k.items);
        setData(k);
      } else if (mode === 'system') {
        setData(await read('system'));
      } else if (mode === 'settings') {
        setData(await read('settings'));
      } else if (['users', 'sources', 'alerts', 'audit'].includes(mode)) {
        setRows(
          await read(
            mode +
              (mode === 'users'
                ? '?search=' +
                  encodeURIComponent(search) +
                  '&role=' +
                  encodeURIComponent(userRoleFilter)
                : mode === 'audit'
                  ? '?page=' + page
                  : ''),
          ),
        );
      } else if (mode !== 'import' && !(admin && mode === 'departments'))
        setError('ไม่พบหน้าที่ร้องขอ');
    } catch (e) {
      if (sequence === requestSequence.current)
        setError(e instanceof Error ? e.message : 'ไม่สามารถโหลดข้อมูลได้');
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [mode, id, admin, query, search, page, userRoleFilter]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (['dashboard', 'wallboard', 'departments'].includes(mode)) {
      const t = setInterval(load, refresh * 1000);
      return () => clearInterval(t);
    }
  }, [load, mode, refresh]);
  async function action(task: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await task();
      setMessage('บันทึกข้อมูลเรียบร้อยแล้ว');
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด');
    } finally {
      setBusy(false);
    }
  }
  const nav = [
    ['dashboard', '◫', 'ภาพรวม'],
    ['departments', '▦', 'กลุ่มงาน'],
    ['kpis', '▤', 'ตัวชี้วัด'],
    ...(entry ? [['entry', '＋', 'กรอกข้อมูล']] : []),
    ...(approver ? [['approvals', '✓', 'การอนุมัติ']] : []),
    ['alerts', '♧', 'แจ้งเตือน'],
    ...(entry ? [['import', '⇧', 'นำเข้าข้อมูล']] : []),
    ['reports', '▥', 'รายงาน'],
    ...(global ? [['wallboard', '▣', 'Command center']] : []),
  ];
  const adminNav = [
    ...(manager ? [['kpis', 'จัดการตัวชี้วัด']] : []),
    ...(superAdmin
      ? [
          ['users', 'ผู้ใช้งาน'],
          ['departments', 'กลุ่มงาน'],
          ['sources', 'แหล่งข้อมูล'],
          ['audit', 'ประวัติการใช้งาน'],
          ['settings', 'ตั้งค่าองค์กร'],
        ]
      : []),
    ...(['SUPER_ADMIN', 'QUALITY_ADMIN'].includes(user.role) ? [['system', 'สถานะระบบ']] : []),
  ];
  function date(value: string) {
    return new Intl.DateTimeFormat('th-TH', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone,
    }).format(new Date(value));
  }
  const chosen = kpis.find((k) => k.id === selectedKpi);
  const dashboard =
    ['dashboard', 'wallboard', 'reports'].includes(mode) || (mode === 'departments' && id);
  return (
    <div className={wall ? 'app wallboard' : 'app'}>
      {!wall && (
        <aside className="sidebar">
          <a href="/dashboard" className="brand">
            <span className="logo">✚</span>
            <span>
              Hospital KPI<small>QUALITY MANAGEMENT</small>
            </span>
          </a>
          <div className="hospital">
            {organization}
            <small>ระบบติดตามตัวชี้วัดโรงพยาบาล</small>
          </div>
          <p className="nav-label">พื้นที่ทำงาน</p>
          <nav>
            {nav.map(([key, icon, title]) => (
              <a className={section === key ? 'active' : ''} key={key} href={'/' + key}>
                <span>{icon}</span>
                {title}
              </a>
            ))}
          </nav>
          {adminNav.length > 0 && (
            <>
              <p className="nav-label">การจัดการ</p>
              <nav>
                {adminNav.map(([key, title]) => (
                  <a
                    className={admin && mode === key ? 'active' : ''}
                    key={key}
                    href={'/admin/' + key}
                  >
                    ⚙ <span>{title}</span>
                  </a>
                ))}
              </nav>
            </>
          )}
          <div className="sidebar-bottom">
            <span className="avatar">{user.displayName.slice(0, 1)}</span>
            <div>
              {user.displayName}
              <small>{user.role}</small>
            </div>
            <button
              className="icon-button"
              title="ออกจากระบบ"
              onClick={() => signOut({ callbackUrl: '/login' })}
            >
              ↪
            </button>
          </div>
        </aside>
      )}
      <div className="main">
        <header>
          <div>
            <span className="breadcrumb">
              ระบบติดตามคุณภาพ <span>/</span> {labels[mode]}
            </span>
          </div>
          <div className="header-right">
            <span className="live-dot" /> อัปเดตทุก {refresh} วินาที{' '}
            <span className="avatar small">{user.displayName.slice(0, 1)}</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <p className="eyebrow">{wall ? organization : 'HOSPITAL PERFORMANCE'}</p>
              <h1>
                {labels[mode] ?? 'ระบบติดตามตัวชี้วัด'}
                {mode === 'departments' && id
                  ? ' · ' + (departments.find((d) => d.id === id)?.nameTh ?? '')
                  : ''}
              </h1>
              <p>ติดตามผลการดำเนินงาน เพื่อพัฒนาคุณภาพบริการอย่างต่อเนื่อง</p>
            </div>
            <div className="actions">
              {wall && (
                <a className="button secondary" href="/dashboard">
                  กลับภาพรวม
                </a>
              )}
              <button className="secondary" onClick={load}>
                ↻ รีเฟรชข้อมูล
              </button>
              {manager && admin && ['kpis', 'users', 'departments', 'sources'].includes(mode) && (
                <button onClick={() => setEditing({})}>＋ เพิ่มข้อมูล</button>
              )}
            </div>
          </div>
          {error && (
            <div role="alert" className="notice error">
              {error}
            </div>
          )}
          {message && (
            <div role="status" className="notice success">
              {message}
            </div>
          )}
          {!data && rows.length === 0 && !error && (
            <section role="status" className="loading-state">
              <p className="muted">{loading ? 'กำลังโหลดข้อมูล…' : 'ยังไม่มีข้อมูล'}</p>
              {loading && dashboard && (
                <div className="skeleton-grid" aria-hidden="true">
                  {[0, 1, 2, 3].map((i) => (
                    <div className="skeleton-card" key={i} />
                  ))}
                </div>
              )}
            </section>
          )}
          {dashboard && data && (
            <>
              <div className="filters">
                <label>
                  รอบข้อมูล
                  <input
                    type="month"
                    value={period}
                    onChange={(e) => {
                      setPeriod(e.target.value);
                      setPage(1);
                    }}
                  />
                </label>
                {global && !(mode === 'departments' && id) && (
                  <label>
                    กลุ่มงาน
                    <select
                      value={department}
                      onChange={(e) => {
                        setDepartment(e.target.value);
                        setPage(1);
                      }}
                    >
                      <option value="">ทุกกลุ่มงาน</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.nameTh}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <span className="updated">
                  {data.lastUpdated
                    ? 'อัปเดตล่าสุด ' + date(data.lastUpdated)
                    : 'ยังไม่มีผลอนุมัติ'}
                  {data.synthetic && <small>ข้อมูลสังเคราะห์เพื่อสาธิตเท่านั้น</small>}
                </span>
                <a className="button secondary" href={'/api/export?' + query}>
                  ⇩ ส่งออก CSV
                </a>
              </div>
              <section className="stats">
                <article className="stat primary">
                  <span>ตัวชี้วัดที่ผ่านเป้าหมาย</span>
                  <strong>
                    {data.achievement}
                    <small>%</small>
                  </strong>
                  <span>
                    จากทั้งหมด{' '}
                    {Object.values(data.counts).reduce((a: number, b: unknown) => a + Number(b), 0)}{' '}
                    ตัวชี้วัด
                  </span>
                  <div className="progress">
                    <i style={{ width: data.achievement + '%' }} />
                  </div>
                </article>
                {Object.entries(statusLabels).map(([key, title]) => (
                  <article className="stat" key={key}>
                    <span className={'status-icon ' + key}>
                      {key === 'GREEN' ? '✓' : key === 'YELLOW' ? '△' : key === 'RED' ? '!' : '—'}
                    </span>
                    <strong>{data.counts[key]}</strong>
                    <span>{title}</span>
                  </article>
                ))}
              </section>
              <article className="sync-strip">
                <strong>สถานะการเชื่อมต่อข้อมูล</strong>
                <span>ผลบนหน้าจออ่านจากฐานข้อมูล KPI · ไม่เรียก HIS ขณะเปิดหน้า</span>
                {data.sync?.length ? (
                  data.sync.map((s: Row) => (
                    <span key={s.id}>
                      {s.name}:{' '}
                      {!s.enabled
                        ? 'ปิดใช้งาน'
                        : !s.lastSyncAt ||
                            now - Date.parse(s.lastSyncAt) > s.staleAfterMinutes * 60000
                          ? '△ ข้อมูลล่าช้า'
                          : '✓ ปกติ'}
                    </span>
                  ))
                ) : (
                  <span>บันทึกด้วยตนเอง / ข้อมูลสังเคราะห์</span>
                )}
              </article>
              <section className="dashboard-grid">
                <article className="panel">
                  <div className="panel-title">
                    <h2>แนวโน้มผลการดำเนินงาน</h2>
                    <span>12 เดือน · ร้อยละผ่านเป้า</span>
                  </div>
                  <Chart data={data.trend} />
                </article>
                <article className="panel">
                  <div className="panel-title">
                    <h2>ผลการดำเนินงานรายกลุ่มงาน</h2>
                    <span>ผ่าน / ทั้งหมด</span>
                  </div>
                  <div className="department-bars">
                    {data.departments.map((d: Row) => (
                      <a key={d.id} href={'/departments/' + d.id}>
                        <div>
                          <span>{d.name}</span>
                          <strong>
                            {d.green}/{d.total}
                          </strong>
                        </div>
                        <div className="progress">
                          <i style={{ width: (d.green / d.total) * 100 + '%' }} />
                        </div>
                      </a>
                    ))}
                  </div>
                </article>
              </section>
              <article className="panel">
                <div className="panel-title">
                  <h2>ติดตามตัวชี้วัด</h2>
                  <span>{data.total} รายการ · ผลที่ได้รับการอนุมัติ</span>
                </div>
                <div className="filters compact">
                  <input
                    aria-label="ค้นหาตัวชี้วัด"
                    placeholder="ค้นหาชื่อหรือรหัสตัวชี้วัด…"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                  />
                  <select
                    aria-label="เรียงลำดับ"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="asc">รหัส A → Z</option>
                    <option value="desc">รหัส Z → A</option>
                  </select>
                  <select
                    aria-label="สถานะ"
                    value={status}
                    onChange={(e) => {
                      setStatus(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">ทุกสถานะ</option>
                    {Object.entries(statusLabels).map(([s, l]) => (
                      <option key={s} value={s}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>ตัวชี้วัด / กลุ่มงาน</th>
                        <th>เป้าหมาย</th>
                        <th>ผลลัพธ์</th>
                        <th>ก่อนหน้า</th>
                        <th>แนวโน้ม</th>
                        <th>สถานะ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((k: Row) => (
                        <tr key={k.id}>
                          <td>
                            <a href={'/kpis/' + k.id}>
                              <strong>{k.nameTh}</strong>
                              <small>
                                {k.code} · {k.department.nameTh}
                              </small>
                            </a>
                          </td>
                          <td>{formatTarget(k.current?.targetSnapshot ?? k)}</td>
                          <td>
                            <strong>{k.current?.value ?? '—'}</strong>
                          </td>
                          <td>
                            {k.previous?.value ?? '—'}
                            {k.previous && (
                              <small>{k.previous.targetSnapshot?.unit ?? k.unit}</small>
                            )}
                          </td>
                          <td>
                            {k.current?.value != null &&
                            k.previous?.value != null &&
                            comparableMetrics(
                              k.current.targetSnapshot ?? k,
                              k.previous.targetSnapshot ?? k,
                            )
                              ? k.current.value > k.previous.value
                                ? '↑'
                                : k.current.value < k.previous.value
                                  ? '↓'
                                  : '→'
                              : '—'}
                          </td>
                          <td>
                            <Badge status={k.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {data.items.length === 0 && (
                  <p className="empty">ยังไม่มีข้อมูลตัวชี้วัดในช่วงเวลานี้</p>
                )}
                <div className="pagination">
                  <button
                    className="secondary"
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                  >
                    ก่อนหน้า
                  </button>
                  <span>หน้า {page}</span>
                  <button
                    className="secondary"
                    disabled={page * 25 >= data.total}
                    onClick={() => setPage(page + 1)}
                  >
                    ถัดไป
                  </button>
                </div>
              </article>
            </>
          )}
          {mode === 'kpis' && !admin && id && data && (
            <>
              <article className="panel">
                <div className="panel-title">
                  <div>
                    <p className="eyebrow">
                      {data.code} · {data.department.nameTh}
                    </p>
                    <h2>{data.nameTh}</h2>
                  </div>
                  <button className="secondary" onClick={() => window.print()}>
                    พิมพ์รายงาน
                  </button>
                </div>
                <p>{data.description}</p>
                <label>
                  กรองรอบข้อมูล
                  <input
                    type="month"
                    value={detailPeriod}
                    onChange={(e) => setDetailPeriod(e.target.value)}
                  />
                </label>
                <div className="detail-grid">
                  <div>
                    เป้าหมายปัจจุบัน
                    <strong>
                      {formatTarget({
                        targetType: data.targetType,
                        targetValue: data.targetValue,
                        targetMin: data.targetMin,
                        targetMax: data.targetMax,
                        unit: data.unit,
                      })}
                    </strong>
                  </div>
                  <div>
                    ความถี่<strong>{data.frequency}</strong>
                  </div>
                  <div>
                    แหล่งข้อมูล<strong>{data.dataSourceType}</strong>
                  </div>
                  <div>
                    ค่าล่าสุด
                    <strong>
                      {data.results[0]?.value ?? 'ไม่มีข้อมูล'}{' '}
                      {data.results[0]?.targetSnapshot?.unit ?? data.unit}
                    </strong>
                  </div>
                </div>
                <Chart
                  data={[...data.results]
                    .filter((r: Row) =>
                      comparableMetrics(r.targetSnapshot ?? data, {
                        unit: data.unit,
                        calculationMode: data.calculationMode,
                        frequency: data.frequency,
                        rateMultiplier: data.rateMultiplier,
                      }),
                    )
                    .reverse()
                    .map((r: Row) => ({ period: r.periodStart.slice(0, 7), achievement: r.value }))}
                />
                <p className="muted">
                  กราฟเปรียบเทียบเฉพาะสูตร หน่วย และความถี่ปัจจุบัน ประวัติเดิมแสดงในตาราง
                </p>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>รอบข้อมูล</th>
                        <th>ตัวตั้ง</th>
                        <th>ตัวหาร</th>
                        <th>เป้าหมายที่ใช้อนุมัติ</th>
                        <th>ผลลัพธ์</th>
                        <th>สถานะ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.results
                        .filter((r: Row) => !detailPeriod || r.periodStart.startsWith(detailPeriod))
                        .map((r: Row) => (
                          <tr key={r.id}>
                            <td>
                              {r.periodStart.slice(0, 10)} – {r.periodEnd.slice(0, 10)}
                            </td>
                            <td>{r.numerator ?? '—'}</td>
                            <td>{r.denominator ?? '—'}</td>
                            <td>{formatTarget(r.targetSnapshot ?? data)}</td>
                            <td>
                              {r.value ?? '—'} {r.targetSnapshot?.unit ?? data.unit}
                            </td>
                            <td>
                              <Badge status={r.status} />
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </article>
            </>
          )}
          {mode === 'departments' && !admin && !id && (
            <div className="cards">
              {rows.map((d) => (
                <a className="panel department-card" href={'/departments/' + d.id} key={d.id}>
                  <span>▦ {d.code}</span>
                  <h2>{d.nameTh}</h2>
                  <p>ดูผลการดำเนินงาน →</p>
                </a>
              ))}
            </div>
          )}
          {mode === 'kpis' && !admin && !id && (
            <article className="panel">
              <div className="filters">
                <input
                  placeholder="ค้นหาตัวชี้วัด"
                  aria-label="ค้นหา"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              {rows.map((k) => (
                <a className="list-row" key={k.id} href={'/kpis/' + k.id}>
                  <span>
                    <strong>{k.nameTh}</strong>
                    <small>
                      {k.code} · {k.department.nameTh}
                    </small>
                  </span>
                  <span>ดูรายละเอียด →</span>
                </a>
              ))}
              <div className="pagination">
                <button disabled={page === 1} onClick={() => setPage(page - 1)}>
                  ก่อนหน้า
                </button>
                <span>{page}</span>
                <button
                  disabled={page * 25 >= (data?.total ?? 0)}
                  onClick={() => setPage(page + 1)}
                >
                  ถัดไป
                </button>
              </div>
            </article>
          )}
          {mode === 'entry' && entry && (
            <article className="panel">
              <h2>บันทึกผลตัวชี้วัด</h2>
              <p className="muted">
                บันทึกเป็นฉบับร่างก่อนส่งอนุมัติ · ค่าผลลัพธ์คำนวณซ้ำบนเซิร์ฟเวอร์
              </p>
              <form
                method="post"
                key={editing?.id ?? 'new'}
                className="form-grid"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  const n = (key: string) => (f.get(key) === '' ? null : Number(f.get(key)));
                  action(() =>
                    api('submissions' + (editing?.id ? '/' + editing.id : ''), {
                      kpiId: selectedKpi,
                      periodStart: f.get('periodStart'),
                      periodEnd: f.get('periodEnd'),
                      numerator: n('numerator'),
                      denominator: n('denominator'),
                      value: n('value'),
                      note: f.get('note') ?? '',
                    }),
                  );
                }}
              >
                <label className="wide">
                  ตัวชี้วัด
                  <select
                    required
                    aria-label="ตัวชี้วัด"
                    value={selectedKpi}
                    onChange={(e) => setSelectedKpi(e.target.value)}
                  >
                    <option value="">เลือกตัวชี้วัด</option>
                    {kpis.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.code} · {k.nameTh}
                      </option>
                    ))}
                  </select>
                </label>
                <Field
                  name="periodStart"
                  label="วันที่เริ่มรอบข้อมูล"
                  type="date"
                  defaultValue={editing?.periodStart?.slice(0, 10)}
                />
                <Field
                  name="periodEnd"
                  label="วันที่สิ้นสุดรอบข้อมูล"
                  type="date"
                  defaultValue={editing?.periodEnd?.slice(0, 10)}
                />
                {chosen?.calculationMode === 'DIRECT_VALUE' ? (
                  <label>
                    ค่าผลลัพธ์
                    <input
                      name="value"
                      type="number"
                      min="0"
                      step="any"
                      required
                      value={direct}
                      onChange={(e) => setDirect(e.target.value)}
                    />
                  </label>
                ) : (
                  <>
                    <label>
                      ตัวตั้ง
                      <input
                        name="numerator"
                        type="number"
                        min="0"
                        step="any"
                        required
                        value={numerator}
                        onChange={(e) => setNumerator(e.target.value)}
                      />
                    </label>
                    <label>
                      ตัวหาร
                      <input
                        name="denominator"
                        type="number"
                        min="0"
                        step="any"
                        required
                        value={denominator}
                        onChange={(e) => setDenominator(e.target.value)}
                      />
                    </label>
                  </>
                )}
                <label className="wide">
                  หมายเหตุ
                  <textarea name="note" defaultValue={editing?.note} maxLength={2000} />
                </label>
                <p>
                  ตัวอย่างผลลัพธ์:{' '}
                  <strong>
                    {chosen
                      ? (calculate(chosen as any, {
                          value: direct === '' ? null : Number(direct),
                          numerator: numerator === '' ? null : Number(numerator),
                          denominator: denominator === '' ? null : Number(denominator),
                        }) ?? 'ไม่มีข้อมูล')
                      : '—'}
                  </strong>
                </p>
                <button disabled={busy}>บันทึกฉบับร่าง</button>
                {editing && (
                  <button type="button" className="secondary" onClick={() => setEditing(null)}>
                    ยกเลิกแก้ไข
                  </button>
                )}
              </form>
            </article>
          )}
          {(mode === 'entry' || mode === 'approvals') && (
            <article className="panel">
              <h2>{mode === 'approvals' ? 'รายการรออนุมัติ' : 'ประวัติการบันทึก'}</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ตัวชี้วัด</th>
                      <th>รอบข้อมูล</th>
                      <th>ผู้บันทึก</th>
                      <th>ผล</th>
                      <th>สถานะ</th>
                      <th>ดำเนินการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows
                      .filter((s) => mode !== 'approvals' || s.state === 'SUBMITTED')
                      .map((s) => (
                        <tr key={s.id}>
                          <td>{s.kpi.nameTh}</td>
                          <td>
                            {s.periodStart.slice(0, 10)}
                            <small>{s.periodEnd.slice(0, 10)}</small>
                          </td>
                          <td>{s.author.displayName}</td>
                          <td>{s.value ?? 'ไม่มีข้อมูล'}</td>
                          <td>
                            {s.state}
                            <small>{s.rejectionReason}</small>
                          </td>
                          <td>
                            <div className="actions">
                              {s.state === 'DRAFT' && s.authorId === user.id && (
                                <>
                                  <button
                                    disabled={busy}
                                    onClick={() =>
                                      action(() => api(`submissions/${s.id}/submit`, {}))
                                    }
                                  >
                                    ส่งอนุมัติ
                                  </button>
                                  <button
                                    className="secondary"
                                    onClick={() => {
                                      setEditing(s);
                                      setSelectedKpi(s.kpiId);
                                      setNumerator(String(s.numerator ?? ''));
                                      setDenominator(String(s.denominator ?? ''));
                                      setDirect(String(s.value ?? ''));
                                    }}
                                  >
                                    แก้ไข
                                  </button>
                                </>
                              )}
                              {s.state === 'SUBMITTED' && approver && s.authorId !== user.id && (
                                <>
                                  <button
                                    disabled={busy}
                                    onClick={() =>
                                      action(() => api(`submissions/${s.id}/approve`, {}))
                                    }
                                  >
                                    อนุมัติ
                                  </button>
                                  <button
                                    disabled={busy}
                                    className="danger"
                                    onClick={() => {
                                      const reason = window.prompt('เหตุผลที่ไม่อนุมัติ (จำเป็น)');
                                      if (reason?.trim())
                                        action(() => api(`submissions/${s.id}/reject`, { reason }));
                                    }}
                                  >
                                    ไม่อนุมัติ
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </article>
          )}
          {mode === 'import' && entry && (
            <article className="panel">
              <h2>นำเข้าข้อมูล CSV</h2>
              <p>อัปโหลด → ตรวจสอบ → ยืนยัน · ผลนำเข้าจะเป็นฉบับร่าง และต้องส่งอนุมัติ</p>
              <a href="/api/csv">⇩ ดาวน์โหลดแม่แบบ CSV</a>
              <label>
                ไฟล์ CSV (ไม่เกิน 250 KB / 500 แถว)
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setPreview(null);
                      if (file.size > 250000) {
                        setError('ไฟล์ใหญ่เกินกำหนด');
                        return;
                      }
                      setCsv(await file.text());
                    }
                  }}
                />
              </label>
              <textarea
                aria-label="ข้อมูล CSV"
                value={csv}
                onChange={(e) => {
                  setCsv(e.target.value);
                  setPreview(null);
                }}
                rows={6}
              />
              <div className="actions">
                <button
                  disabled={busy || !csv}
                  onClick={() =>
                    action(async () => setPreview(await api('csv', { text: csv, confirm: false })))
                  }
                >
                  ตรวจสอบและแสดงตัวอย่าง
                </button>
                {preview && !preview.some((r) => r.error) && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      action(async () => {
                        await api('csv', { text: csv, confirm: true });
                        setPreview(null);
                        setCsv('');
                      })
                    }
                  >
                    ยืนยันนำเข้า {preview.length} รายการ
                  </button>
                )}
              </div>
              {preview && (
                <table>
                  <thead>
                    <tr>
                      <th>แถว</th>
                      <th>ค่าผลลัพธ์</th>
                      <th>ผลตรวจสอบ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((r) => (
                      <tr key={r.row}>
                        <td>{r.row}</td>
                        <td>{r.value ?? 'ไม่มีข้อมูล'}</td>
                        <td>{r.error ?? '✓ พร้อมนำเข้า'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </article>
          )}
          {mode === 'alerts' && (
            <article className="panel">
              <h2>การแจ้งเตือนที่ยังไม่ปิด</h2>
              {rows.length === 0 && <p className="empty">ไม่มีการแจ้งเตือน</p>}
              {rows.map((r) => (
                <div className="list-row" key={r.id}>
                  <span>
                    <Badge status={r.type === 'RED_KPI' ? 'RED' : 'YELLOW'} /> {r.message}
                    <small>
                      {date(r.createdAt)} · {r.type}
                    </small>
                  </span>
                  {manager && (
                    <button
                      className="secondary"
                      onClick={() => action(() => api('alerts/' + r.id, {}))}
                    >
                      รับทราบ / ปิด
                    </button>
                  )}
                </div>
              ))}
            </article>
          )}
          {mode === 'system' && data && (
            <>
              <div className="stats">
                <article className="stat">
                  <span>Web / Database</span>
                  <strong>✓</strong>
                  <span>
                    {data.web} / {data.database}
                  </span>
                </article>
                <article className="stat">
                  <span>Worker heartbeat</span>
                  <strong>
                    {data.heartbeat && now - Date.parse(data.heartbeat.updatedAt) < 600000
                      ? '✓'
                      : '△'}
                  </strong>
                  <span>
                    {data.heartbeat ? date(data.heartbeat.updatedAt) : 'ยังไม่เริ่มทำงาน'}
                  </span>
                </article>
              </div>
              <article className="panel">
                <h2>การซิงก์ข้อมูล · v{data.version}</h2>
                {data.sources.map((s: Row) => (
                  <div key={s.id} className="list-row">
                    <span>
                      <strong>
                        {s.name} · {s.type}
                      </strong>
                      <small>
                        {s.enabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน'} ·{' '}
                        {s.lastSyncAt ? date(s.lastSyncAt) : 'ยังไม่ซิงก์'}
                        {s.enabled &&
                        (!s.lastSyncAt ||
                          now - Date.parse(s.lastSyncAt) > s.staleAfterMinutes * 60000)
                          ? ' · ข้อมูลล่าช้า'
                          : ''}
                      </small>
                      {s.runs.map((r: Row) => (
                        <small key={r.id}>
                          {date(r.startedAt)} · {r.state} · {r.count} รายการ · {r.message}
                        </small>
                      ))}
                    </span>
                  </div>
                ))}
              </article>
            </>
          )}
          {mode === 'settings' && data && superAdmin && (
            <article className="panel">
              <form
                method="post"
                className="form-grid"
                onSubmit={(e) => {
                  e.preventDefault();
                  action(() => api('settings', Object.fromEntries(new FormData(e.currentTarget))));
                }}
              >
                <Field name="name" label="ชื่อองค์กร" defaultValue={data.name} />
                <Field name="timezone" label="เขตเวลา" defaultValue={data.timezone} />
                <button disabled={busy}>บันทึกการตั้งค่า</button>
              </form>
            </article>
          )}
          {mode === 'audit' && (
            <article className="panel">
              <h2>ประวัติการใช้งานระบบ</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>เวลา</th>
                      <th>ผู้ดำเนินการ</th>
                      <th>กิจกรรม</th>
                      <th>รายการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td>{date(r.createdAt)}</td>
                        <td>
                          {r.actorRole}
                          <small>{r.actorUserId ?? 'SYSTEM_WORKER'}</small>
                        </td>
                        <td>{r.action}</td>
                        <td>
                          {r.entityType}
                          <small>{r.entityId}</small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pagination">
                <button disabled={page === 1} onClick={() => setPage(page - 1)}>
                  ก่อนหน้า
                </button>
                <span>{page}</span>
                <button disabled={rows.length < 100} onClick={() => setPage(page + 1)}>
                  ถัดไป
                </button>
              </div>
            </article>
          )}
          {admin && ['kpis', 'users', 'departments', 'sources'].includes(mode) && (
            <>
              <article className="panel">
                {mode === 'users' && (
                  <div className="filters">
                    <label>
                      ค้นหาผู้ใช้งาน
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="ชื่อ อีเมล หรือชื่อผู้ใช้"
                      />
                    </label>
                    <label>
                      บทบาท
                      <select
                        aria-label="บทบาท"
                        value={userRoleFilter}
                        onChange={(e) => setUserRoleFilter(e.target.value)}
                      >
                        <option value="">ทุกบทบาท</option>
                        {roles.map((role) => (
                          <option key={role}>{role}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>รหัส / ชื่อ</th>
                        <th>รายละเอียด</th>
                        <th>สถานะ</th>
                        <th>ดำเนินการ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(mode === 'departments' ? departments : rows).map((r) => (
                        <tr key={r.id}>
                          <td>
                            <strong>{r.nameTh ?? r.displayName ?? r.name}</strong>
                            <small>{r.code ?? r.username ?? r.type}</small>
                          </td>
                          <td>
                            {r.email ?? r.unit ?? r.schedule ?? r.nameEn ?? ''}
                            {r.role && <small>{r.role}</small>}
                          </td>
                          <td>
                            {(r.active ?? r.isActive ?? r.enabled) ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
                          </td>
                          <td>
                            <button className="secondary" onClick={() => setEditing(r)}>
                              แก้ไข
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {mode === 'kpis' && (
                  <div className="pagination">
                    <button disabled={page === 1} onClick={() => setPage(page - 1)}>
                      ก่อนหน้า
                    </button>
                    <span>{page}</span>
                    <button
                      disabled={page * 25 >= (data?.total ?? 0)}
                      onClick={() => setPage(page + 1)}
                    >
                      ถัดไป
                    </button>
                  </div>
                )}
              </article>
              {editing && (
                <article className="panel editor">
                  <div className="panel-title">
                    <h2>{editing.id ? 'แก้ไขข้อมูล' : 'เพิ่มข้อมูล'}</h2>
                    <button className="secondary" onClick={() => setEditing(null)}>
                      ปิด
                    </button>
                  </div>
                  <form
                    method="post"
                    key={editing.id ?? 'new'}
                    className="form-grid"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      const b: Row = Object.fromEntries(f);
                      const num = [
                        'targetValue',
                        'targetMin',
                        'targetMax',
                        'warningThreshold',
                        'warningMin',
                        'warningMax',
                        'decimalPlaces',
                        'displayOrder',
                        'rateMultiplier',
                        'sortOrder',
                        'staleAfterMinutes',
                      ];
                      num.forEach((key) => {
                        if (key in b) b[key] = b[key] === '' ? null : Number(b[key]);
                      });
                      ['active', 'isActive', 'enabled'].forEach((key) => {
                        if (f.has(key)) b[key] = b[key] === 'true';
                      });
                      if (mode === 'users') {
                        if (!b.password) delete b.password;
                        if (!b.departmentId) b.departmentId = null;
                      }
                      if (mode === 'kpis') b.dataSourceId = b.dataSourceId || null;
                      action(() => api(mode + (editing.id ? '/' + editing.id : ''), b));
                    }}
                  >
                    {mode === 'kpis' && (
                      <>
                        <Field name="code" label="รหัสตัวชี้วัด" defaultValue={editing.code} />
                        <Field
                          name="nameTh"
                          label="ชื่อตัวชี้วัดภาษาไทย"
                          defaultValue={editing.nameTh}
                        />
                        <Field
                          name="nameEn"
                          label="ชื่อภาษาอังกฤษ"
                          defaultValue={editing.nameEn}
                          required={false}
                        />
                        <Field
                          name="description"
                          label="คำอธิบาย"
                          defaultValue={editing.description}
                          required={false}
                        />
                        <label>
                          กลุ่มงาน
                          <select
                            name="departmentId"
                            defaultValue={editing.departmentId ?? user.departmentId ?? ''}
                            required
                          >
                            {departments.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.nameTh}
                              </option>
                            ))}
                          </select>
                        </label>
                        <Field name="unit" label="หน่วย" defaultValue={editing.unit} />
                        {[
                          [
                            'frequency',
                            'ความถี่',
                            ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'],
                          ],
                          [
                            'calculationMode',
                            'การคำนวณ',
                            ['DIRECT_VALUE', 'PERCENTAGE', 'RATE', 'RATIO'],
                          ],
                          ['targetType', 'รูปแบบเป้าหมาย', ['GTE', 'LTE', 'BETWEEN']],
                          [
                            'dataSourceType',
                            'แหล่งข้อมูล',
                            ['MANUAL', 'CSV_IMPORT', 'HIS', 'SYSTEM'],
                          ],
                        ].map(([key, title, options]) => (
                          <label key={key as string}>
                            {title as string}
                            <select
                              name={key as string}
                              defaultValue={
                                editing[key as string] ??
                                (key === 'frequency' ? 'MONTHLY' : undefined)
                              }
                            >
                              {(options as string[]).map((o) => (
                                <option key={o}>{o}</option>
                              ))}
                            </select>
                          </label>
                        ))}
                        {[
                          ['targetValue', 'เป้าหมาย', 0],
                          ['targetMin', 'เป้าหมายต่ำสุด', null],
                          ['targetMax', 'เป้าหมายสูงสุด', null],
                          ['warningThreshold', 'ขอบเขตเฝ้าระวัง', null],
                          ['warningMin', 'เฝ้าระวังต่ำสุด', null],
                          ['warningMax', 'เฝ้าระวังสูงสุด', null],
                          ['decimalPlaces', 'ทศนิยม', 2],
                          ['rateMultiplier', 'ตัวคูณอัตรา', 1000],
                          ['displayOrder', 'ลำดับ', 0],
                        ].map(([key, title, value]) => (
                          <Field
                            key={String(key)}
                            name={String(key)}
                            label={String(title)}
                            type="number"
                            defaultValue={editing[String(key)] ?? value ?? ''}
                            required={
                              ![
                                'targetMin',
                                'targetMax',
                                'warningThreshold',
                                'warningMin',
                                'warningMax',
                              ].includes(String(key))
                            }
                          />
                        ))}
                        <label>
                          แหล่งข้อมูลเชื่อมต่อ
                          <select name="dataSourceId" defaultValue={editing.dataSourceId ?? ''}>
                            <option value="">ไม่ได้เชื่อมต่อ</option>
                            {sources.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name} · {s.type}
                              </option>
                            ))}
                          </select>
                        </label>
                        <Field
                          name="owner"
                          label="ผู้รับผิดชอบ"
                          defaultValue={editing.owner}
                          required={false}
                        />
                      </>
                    )}
                    {mode === 'users' && (
                      <>
                        <Field
                          name="email"
                          label="อีเมล"
                          type="email"
                          defaultValue={editing.email}
                        />
                        <Field name="username" label="ชื่อผู้ใช้" defaultValue={editing.username} />
                        <Field
                          name="displayName"
                          label="ชื่อที่แสดง"
                          defaultValue={editing.displayName}
                        />
                        <Field
                          name="password"
                          label={
                            editing.id
                              ? 'ตั้งรหัสผ่านใหม่ (เว้นว่างหากไม่เปลี่ยน)'
                              : 'รหัสผ่าน (อย่างน้อย 12 ตัวอักษร)'
                          }
                          type="password"
                          required={!editing.id}
                        />
                        <label>
                          บทบาท
                          <select name="role" defaultValue={editing.role ?? 'VIEWER'}>
                            {[
                              'SUPER_ADMIN',
                              'EXECUTIVE',
                              'QUALITY_ADMIN',
                              'DEPARTMENT_ADMIN',
                              'DATA_ENTRY',
                              'VIEWER',
                            ].map((r) => (
                              <option key={r}>{r}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          กลุ่มงาน
                          <select name="departmentId" defaultValue={editing.departmentId ?? ''}>
                            <option value="">ระดับองค์กร</option>
                            {departments.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.nameTh}
                              </option>
                            ))}
                          </select>
                        </label>
                      </>
                    )}
                    {mode === 'departments' && (
                      <>
                        <Field
                          name="code"
                          label="รหัสถาวร (ไม่เปลี่ยนเมื่อแก้ไข)"
                          defaultValue={editing.code}
                        />
                        <Field name="nameTh" label="ชื่อภาษาไทย" defaultValue={editing.nameTh} />
                        <Field
                          name="nameEn"
                          label="ชื่อภาษาอังกฤษ"
                          defaultValue={editing.nameEn}
                          required={false}
                        />
                        <Field
                          name="sortOrder"
                          label="ลำดับ"
                          type="number"
                          defaultValue={editing.sortOrder ?? 0}
                        />
                      </>
                    )}
                    {mode === 'sources' && (
                      <>
                        <Field name="name" label="ชื่อแหล่งข้อมูล" defaultValue={editing.name} />
                        <label>
                          ชนิด
                          <select name="type" defaultValue={editing.type ?? 'MOCK'}>
                            {['MANUAL', 'CSV', 'MOCK', 'HIMPRO', 'OTHER_DATABASE'].map((v) => (
                              <option key={v}>{v}</option>
                            ))}
                          </select>
                        </label>
                        <Field
                          name="schedule"
                          label="ตาราง cron (UTC)"
                          defaultValue={editing.schedule ?? '*/5 * * * *'}
                        />
                        <Field
                          name="staleAfterMinutes"
                          label="แจ้งเตือนเมื่อเกิน (นาที)"
                          type="number"
                          defaultValue={editing.staleAfterMinutes ?? 60}
                        />
                      </>
                    )}
                    <label>
                      สถานะ
                      <select
                        name={
                          mode === 'users' ? 'isActive' : mode === 'sources' ? 'enabled' : 'active'
                        }
                        defaultValue={String(
                          editing.active ?? editing.isActive ?? editing.enabled ?? true,
                        )}
                      >
                        <option value="true">เปิดใช้งาน</option>
                        <option value="false">ปิดใช้งาน</option>
                      </select>
                    </label>
                    <div className="wide">
                      <button disabled={busy}>บันทึกข้อมูล</button>
                    </div>
                  </form>
                </article>
              )}
            </>
          )}
          <footer>
            Hospital KPI Management System · ข้อมูลรวมเท่านั้น ไม่มีข้อมูลผู้ป่วย · {organization}
          </footer>
        </main>
      </div>
    </div>
  );
}
