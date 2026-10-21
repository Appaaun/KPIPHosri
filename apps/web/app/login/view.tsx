'use client';
import { signIn } from 'next-auth/react';
import { useState, useEffect } from 'react';
export default function Login({ organization }: { organization: string }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <main className="login">
      <section className="login-brand">
        <div className="logo">✚</div>
        <p>HOSPITAL KPI PLATFORM</p>
        <h1>
          ข้อมูลที่เชื่อมโยง
          <br />
          สู่คุณภาพที่ยั่งยืน
        </h1>
        <p>
          ติดตามผลลัพธ์ ประสานทีมงาน
          <br />
          พัฒนาคุณภาพบริการด้วยข้อมูลที่เชื่อถือได้
        </p>
      </section>
      <section className="login-form">
        <p className="eyebrow">ยินดีต้อนรับ</p>
        <h2>{organization}</h2>
        <p>ระบบติดตามตัวชี้วัดโรงพยาบาล</p>
        <form
          method="post"
          action="/api/auth/callback/credentials"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const f = new FormData(e.currentTarget);
            const passwordInput = e.currentTarget.elements.namedItem(
              'password',
            ) as HTMLInputElement;
            passwordInput.value = '';
            const result = await signIn('credentials', {
              username: f.get('username'),
              password: f.get('password'),
              redirect: false,
              callbackUrl: '/dashboard',
            });
            setBusy(false);
            // Full navigation ensures server components read the newly issued session cookie.
            if (result?.ok && !result.error)
              window.location.assign(
                result.url ?? new URL('/dashboard', window.location.origin).href,
              );
            else setError('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
          }}
        >
          <label>
            ชื่อผู้ใช้ / อีเมล
            <input name="username" autoComplete="username" required />
          </label>
          <label>
            รหัสผ่าน
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button disabled={busy || !ready}>{busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ →'}</button>
        </form>
        <small>
          สำหรับบุคลากรที่ได้รับอนุญาตเท่านั้น
          <br />
          ข้อมูลสาธิตเป็นข้อมูลสังเคราะห์ ไม่มีข้อมูลผู้ป่วย
        </small>
      </section>
    </main>
  );
}
