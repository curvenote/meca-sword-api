import { redirect } from 'react-router';
import { signOut } from '@/lib/auth.server';
import type { Route } from './+types/logout';

export const loader = () => redirect('/');
export const action = ({ request }: Route.ActionArgs) => signOut(request);
