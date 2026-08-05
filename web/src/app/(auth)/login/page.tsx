import AuthForm from '@/components/AuthForm';

export const metadata = { title: 'Sign in · FindHome' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : (v ?? ''));

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  // `next` is set by the middleware when it bounces a signed-out visitor.
  return <AuthForm mode="login" next={first(sp.next)} invite={first(sp.invite)} />;
}
