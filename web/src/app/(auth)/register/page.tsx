import AuthForm from '@/components/AuthForm';

export const metadata = { title: 'Create account · FindHome' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : (v ?? ''));

export default async function RegisterPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  // /register?invite=CODE — the link PartyPanel copies to the clipboard.
  return <AuthForm mode="register" invite={first(sp.invite)} next={first(sp.next)} />;
}
