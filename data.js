import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase.js';

// Small helper: run a query, keep data / error / loading, allow reload.
export function useQuery(fn, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(async () => {
    setLoading(true);
    const { data: d, error: e } = await fn();
    setData(d || []);
    setError(e ? e.message : '');
    setLoading(false);
  }, deps);

  useEffect(() => { run(); }, [run]);
  return { data, error, loading, reload: run };
}

export const fetchClasses = () =>
  supabase.from('classes').select('*').order('name');

export const fetchTeachers = () =>
  supabase.from('profiles').select('id, full_name, email, phone, role, staff_code').in('role', ['teacher', 'admin']).order('full_name');

// Classes this person can take attendance / reports for.
export function fetchMyClasses(profile) {
  let q = supabase.from('classes').select('*').order('name');
  if (profile.role !== 'admin') q = q.eq('teacher_id', profile.id);
  return q;
}

// Supabase returns at most 1000 rows per request, so page through.
export async function fetchAllRows(build) {
  const size = 1000;
  const all = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await build().range(from, from + size - 1);
    if (error) throw error;
    all.push(...data);
    if (data.length < size) return all;
  }
}
