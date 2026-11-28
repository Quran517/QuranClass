import { needsSql } from './finance.js';
import { useState } from 'react';
import { supabase } from './supabase.js';
import { useQuery } from './data.js';
import { formatDate, today, whatsappLink } from './util.js';
import { downloadExcel, downloadPdf } from './exports.js';
import { getSettings } from './settings.js';
import Modal from './Modal.jsx';
import { money, cur, round2, monthStart, monthLabel, addMonths, fetchMethods, isMissing, NEEDS_SQL } from './finance.js';

// class days in a month (from Settings → class days); for the current month, only days up to today
export function classDaysIn(month) {
  const days = getSettings().class_days || [6];
  const d = new Date(month + 'T00:00:00'); const m = d.getMonth();
  const now = new Date(); const last = (d.getFullYear() === now.getFullYear() && m === now.getMonth()) ? now.getDate() : 31;
  let n = 0;
  for (; d.getMonth() === m && d.getDate() <= last; d.setDate(d.getDate() + 1)) if (days.includes(d.getDay())) n++;
  return n;
}

const TYPE = { monthly: 'Fixed monthly', per_class: 'Per class taught', volunteer: 'Volunteer (no pay)' };
const sumList = (l) => round2((l || []).reduce((n, x) => n + Number(x.amount || 0), 0));
export const slipNet = (s) => round2(Number(s.basic || 0) + sumList(s.allowances) - sumList(s.deductions));
const staffName = (p) => (p ? p.full_name || p.email : '');

export async function payslipPdf(s, person) {
  const st = getSettings();
  const rows = [
    ['Basic pay', s.pay_type === 'per_class' ? `${s.classes} classes × ${money(s.rate, false)}` : TYPE[s.pay_type] || '', money(s.basic, false)],
    ...(s.allowances || []).map((a) => ['Allowance', a.label, money(a.amount, false)]),
    ...(s.deductions || []).map((d) => ['Deduction', d.label, '−' + money(d.amount, false)]),
  ];
  await downloadPdf(`payslip-${s.slip_no}-${(person?.full_name || 'staff').replace(/[^\w]+/g, '-').toLowerCase()}.pdf`, {
    title: `Payslip ${s.slip_no} — ${monthLabel(s.month)}`,
    subtitle: `${st.school_name}`,
    orientation: 'portrait',
    tables: [
      { heading: 'Staff member', columns: ['Name', 'Staff ID', 'Phone', 'Pay type'], rows: [[staffName(person), person?.staff_code || '', person?.phone || '', TYPE[s.pay_type] || s.pay_type]], compact: true },
      { heading: 'Pay', columns: ['Item', 'Details', `Amount (${cur()})`], rows, compact: true },
      { heading: 'Net pay', columns: ['Net pay', 'Status', 'Paid on', 'Method'], rows: [[money(s.net), s.status === 'paid' ? 'Paid' : s.status === 'draft' ? 'Not paid yet' : 'Cancelled', s.paid_on ? formatDate(s.paid_on) : '—', s.method || '—']], compact: true },
    ],
    signatures: ['Staff signature', 'Treasurer / Admin'],
  });
}

export default function StaffPay() {
  const [view, setView] = useState('slips');
  const [month, setMonth] = useState(monthStart());
  const staff = useQuery(() => supabase.from('profiles').select('*').in('role', ['teacher', 'admin']).order('full_name').then((r) => ({ ...r, data: (r.data || []).filter((p) => p.active !== false) })));
  const pay = useQuery(() => supabase.from('staff_pay').select('*'));
  const slips = useQuery(() => supabase.from('payslips').select('*').eq('month', month).order('created_at'), [month]);
  const methods = useQuery(fetchMethods);
  const err0 = staff.error || pay.error || slips.error;
  if (err0) return <section className="card"><h2>Staff payments</h2><p className="error">{isMissing(err0) ? needsSql(err0) : err0}</p></section>;
  return (
    <>
      <section className="card">
        <h2>Staff payments</h2>
        <p className="small muted">Teachers can be paid a fixed monthly amount, paid for each class taught (from Staff attendance), or be volunteers. Make the payslips, add allowances or deductions, then pay — the payment is added to Expenses.</p>
        <div className="seg-tabs">
          {[['slips', 'Payslips'], ['setup', 'Pay settings']].map(([k, l]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}
        </div>
      </section>
      {!staff.data || !pay.data ? <div className="spinner" /> : view === 'setup'
        ? <PaySetup staff={staff.data} pay={pay} />
        : <Slips month={month} setMonth={setMonth} staff={staff.data} pay={pay.data} slips={slips} methods={methods.data || []} />}
    </>
  );
}

function PaySetup({ staff, pay }) {
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState('');
  const [edits, setEdits] = useState({});
  const cur0 = (id) => ({ pay_type: 'monthly', amount: 0, note: '', ...(pay.data || []).find((x) => x.profile_id === id), ...edits[id] });
  async function save(id) {
    setErr(''); setSaved('');
    const v = cur0(id);
    const row = { profile_id: id, pay_type: v.pay_type, amount: round2(v.amount), note: v.note || null };
    if (v.absence_deduct !== undefined) row.absence_deduct = v.pay_type === 'monthly' && !!v.absence_deduct;
    let { error } = await supabase.from('staff_pay').upsert(row);
    if (error && /absence_deduct/.test(error.message)) { setErr('“Reduce for missed classes” needs update-29.sql in Supabase. Saved without it.'); delete row.absence_deduct; ({ error } = await supabase.from('staff_pay').upsert(row)); }
    if (error) setErr(error.message); else { setSaved('Saved.'); const n = { ...edits }; delete n[id]; setEdits(n); pay.reload(); }
  }
  return (
    <section className="card">
      <h3>Pay settings</h3>
      {err && <p className="error">{err}</p>}{saved && <p className="success">{saved}</p>}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Staff</th><th>Pay type</th><th className="num">Amount ({cur()})</th><th>Note</th><th /></tr></thead>
          <tbody>
            {staff.map((p) => { const v = cur0(p.id); const dirty = !!edits[p.id]; return (
              <tr key={p.id}>
                <td><b>{staffName(p)}</b> <span className="small muted">{p.staff_code}</span></td>
                <td><select value={v.pay_type} onChange={(e) => setEdits({ ...edits, [p.id]: { ...edits[p.id], pay_type: e.target.value } })}>{Object.entries(TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                <td className="num">{v.pay_type === 'volunteer' ? <span className="muted">—</span> : <input type="number" min="0" step="0.01" style={{ width: 110 }} value={v.amount} onChange={(e) => setEdits({ ...edits, [p.id]: { ...edits[p.id], amount: e.target.value } })} />}<div className="small muted">{v.pay_type === 'per_class' ? 'for each class' : v.pay_type === 'monthly' ? 'each month' : ''}</div>
                  {v.pay_type === 'monthly' && <label className="inline small"><input type="checkbox" checked={!!v.absence_deduct} onChange={(e) => setEdits({ ...edits, [p.id]: { ...edits[p.id], absence_deduct: e.target.checked } })} /> Reduce for missed classes</label>}</td>
                <td><input value={v.note || ''} onChange={(e) => setEdits({ ...edits, [p.id]: { ...edits[p.id], note: e.target.value } })} placeholder="Bank / IBAN, notes" /></td>
                <td><button className="btn small" disabled={!dirty} onClick={() => save(p.id)}>Save</button></td>
              </tr>); })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Slips({ month, setMonth, staff, pay, slips, methods }) {
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(null);
  const [paying, setPaying] = useState(null);
  const months = Array.from({ length: 15 }, (_, i) => addMonths(monthStart(), i - 12));
  const list = (slips.data || []).filter((s) => s.status !== 'cancelled');
  const person = (id) => staff.find((p) => p.id === id);
  const payable = pay.filter((x) => x.pay_type !== 'volunteer' && staff.some((p) => p.id === x.profile_id));
  const missing = payable.filter((x) => !list.some((s) => s.profile_id === x.profile_id));

  async function prepare() {
    setErr(''); setMsg(''); setBusy(true);
    const { data: taught, error: e1 } = await supabase.rpc('fin_classes_taught', { p_month: month });
    if (e1) { setBusy(false); setErr(isMissing(e1) ? needsSql(e1) : e1.message); return; }
    const days = Object.fromEntries((taught || []).map((t) => [t.profile_id, t.days]));
    const excused = Object.fromEntries((taught || []).map((t) => [t.profile_id, t.excused || 0]));
    const held = classDaysIn(month);
    const rows = missing.map((x) => {
      const came = days[x.profile_id] || 0;
      if (x.pay_type === 'per_class') {
        const basic = round2(came * Number(x.amount));
        return { profile_id: x.profile_id, month, pay_type: x.pay_type, classes: came, rate: x.amount, basic, net: basic, allowances: [], deductions: [] };
      }
      const basic = round2(x.amount);
      const deductions = [];
      if (x.absence_deduct && held > 0) {
        const missed = Math.max(0, held - came - (excused[x.profile_id] || 0));
        if (missed > 0) deductions.push({ label: `Missed ${missed} of ${held} classes`, amount: round2((basic / held) * missed) });
      }
      const slip = { profile_id: x.profile_id, month, pay_type: x.pay_type, classes: came, rate: held ? round2(basic / held) : 0, basic, allowances: [], deductions };
      return { ...slip, net: slipNet(slip) };
    });
    const { error } = rows.length ? await supabase.from('payslips').insert(rows) : { error: null };
    setBusy(false);
    if (error) setErr(error.message); else { setMsg(`${rows.length} payslip${rows.length === 1 ? '' : 's'} prepared for ${monthLabel(month)}.`); slips.reload(); }
  }
  async function cancel(s) {
    if (!window.confirm(`Cancel payslip ${s.slip_no} for ${staffName(person(s.profile_id))}?`)) return;
    const { error } = await supabase.from('payslips').update({ status: 'cancelled' }).eq('id', s.id);
    if (error) setErr(error.message); else slips.reload();
  }
  const total = round2(list.reduce((n, s) => n + Number(s.net), 0));
  const paid = round2(list.filter((s) => s.status === 'paid').reduce((n, s) => n + Number(s.net), 0));
  const xrows = () => list.map((s) => ({ 'Payslip': s.slip_no, Staff: staffName(person(s.profile_id)), 'Staff ID': person(s.profile_id)?.staff_code || '', 'Pay type': TYPE[s.pay_type], Classes: s.pay_type === 'per_class' ? s.classes : '', Basic: Number(s.basic), Allowances: sumList(s.allowances), Deductions: sumList(s.deductions), Net: Number(s.net), Status: s.status === 'paid' ? 'Paid' : 'Not paid', 'Paid on': s.paid_on ? formatDate(s.paid_on) : '', Method: s.method || '' }));
  const wa = (s) => { const p = person(s.profile_id); return whatsappLink(p?.phone, `Assalamu Alaikum ${staffName(p)},\n\nYour payslip ${s.slip_no} for ${monthLabel(s.month)}: net pay ${money(s.net)}${s.status === 'paid' ? `, paid on ${formatDate(s.paid_on)} (${s.method || ''})` : ''}.\n\nJazakAllahu khairan,\n${getSettings().school_name}`); };

  return (
    <>
      <section className="card">
        <div className="filters">
          <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
          <button className="btn" disabled={busy || !missing.length} onClick={prepare}>{busy ? 'Preparing…' : missing.length ? `Prepare ${missing.length} payslip${missing.length === 1 ? '' : 's'}` : 'All payslips prepared'}</button>
          <button className="btn ghost small" disabled={!list.length} onClick={() => downloadExcel(`staff-payments-${month.slice(0, 7)}.xlsx`, [{ name: 'Payslips', rows: xrows() }], { title: `Staff payments — ${monthLabel(month)}`, subtitle: `Total ${money(total)} · Paid ${money(paid)}` })}>Excel</button>
          <button className="btn ghost small" disabled={!list.length} onClick={() => downloadPdf(`staff-payments-${month.slice(0, 7)}.pdf`, { title: `Staff payments — ${monthLabel(month)}`, subtitle: `Total ${money(total)}   ·   Paid ${money(paid)}   ·   To pay ${money(round2(total - paid))}`, tables: [{ heading: 'Payslips', columns: Object.keys(xrows()[0]), rows: xrows().map((r) => Object.values(r).map((v) => (typeof v === 'number' ? money(v, false) : v))), compact: true }], signatures: ['Prepared by', 'Approved by'] })}>PDF</button>
        </div>
        {!payable.length && <p className="notice-inline small">First set each teacher's pay in the <b>Pay settings</b> tab.</p>}
        <p className="small"><b>Total {money(total)}</b> · <b className="up">Paid {money(paid)}</b> · <b className="dn">To pay {money(round2(total - paid))}</b></p>
        {msg && <p className="success">{msg}</p>}{err && <p className="error">{err}</p>}
        {list.length > 0 && (
          <div className="table-wrap">
            <table className="table fin-table">
              <thead><tr><th>Payslip</th><th>Staff</th><th>Pay</th><th className="num">Basic</th><th className="num">+ Allowances</th><th className="num">− Deductions</th><th className="num">Net</th><th>Status</th><th /></tr></thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id}>
                    <td className="nowrap">{s.slip_no}</td>
                    <td><b>{staffName(person(s.profile_id))}</b> <span className="small muted">{person(s.profile_id)?.staff_code}</span></td>
                    <td className="small">{TYPE[s.pay_type]}{s.pay_type === 'per_class' ? ` · ${s.classes} × ${money(s.rate, false)}` : (s.deductions || []).some((d) => /^Missed/.test(d.label)) ? ` · attended ${s.classes}` : ''}</td>
                    <td className="num">{money(s.basic, false)}</td><td className="num up">{money(sumList(s.allowances), false)}</td><td className="num dn">{money(sumList(s.deductions), false)}</td>
                    <td className="num"><b>{money(s.net, false)}</b></td>
                    <td>{s.status === 'paid' ? <span className="fpill ok">Paid {formatDate(s.paid_on)}</span> : <span className="fpill part">Not paid</span>}</td>
                    <td className="acts">
                      {s.status === 'draft' && <><button className="btn small" onClick={() => setPaying(s)}>Pay</button>{' '}<button className="btn ghost small" onClick={() => setEdit({ ...s })}>Edit</button>{' '}</>}
                      <button className="btn ghost small" onClick={() => payslipPdf(s, person(s.profile_id))}>⬇ Payslip</button>{' '}
                      {wa(s) && <a className="btn whatsapp small" target="_blank" rel="noreferrer" href={wa(s)}>WhatsApp</a>}{' '}
                      {s.status === 'draft' && <button className="link small" onClick={() => cancel(s)}>cancel</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pay.filter((x) => x.pay_type === 'volunteer').length > 0 && <p className="small muted">Volunteers (no payslip): {pay.filter((x) => x.pay_type === 'volunteer').map((x) => staffName(person(x.profile_id))).filter(Boolean).join(', ')}</p>}
      </section>
      {edit && <SlipEdit slip={edit} who={staffName(person(edit.profile_id))} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); slips.reload(); }} />}
      {paying && <PaySlip slip={paying} who={staffName(person(paying.profile_id))} methods={methods} onClose={() => setPaying(null)} onSaved={(no) => { setPaying(null); setMsg(`Paid — added to expenses as ${no}.`); slips.reload(); }} />}
    </>
  );
}

function SlipEdit({ slip, who, onClose, onSaved }) {
  const [s, setS] = useState({ ...slip, allowances: [...(slip.allowances || [])], deductions: [...(slip.deductions || [])] });
  const [err, setErr] = useState('');
  const line = (k, i, field, v) => { const l = [...s[k]]; l[i] = { ...l[i], [field]: v }; setS({ ...s, [k]: l }); };
  const basic = s.pay_type === 'per_class' ? round2(Number(s.classes || 0) * Number(s.rate || 0)) : Number(s.basic || 0);
  async function save(e) {
    e.preventDefault();
    const clean = (l) => l.filter((x) => x.label && Number(x.amount)).map((x) => ({ label: x.label, amount: round2(x.amount) }));
    const v = { classes: Number(s.classes) || 0, rate: Number(s.rate) || 0, basic: round2(basic), allowances: clean(s.allowances), deductions: clean(s.deductions), note: s.note || null };
    v.net = slipNet(v);
    const { error } = await supabase.from('payslips').update(v).eq('id', slip.id);
    if (error) setErr(error.message); else onSaved();
  }
  return (
    <Modal title={`Payslip ${slip.slip_no} — ${who}`} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        {s.pay_type === 'per_class' ? (
          <>
            <label>Classes taught<input type="number" min="0" value={s.classes} onChange={(e) => setS({ ...s, classes: e.target.value })} /></label>
            <label>Amount per class ({cur()})<input type="number" min="0" step="0.01" value={s.rate} onChange={(e) => setS({ ...s, rate: e.target.value })} /></label>
          </>
        ) : <label className="span2">Basic pay ({cur()})<input type="number" min="0" step="0.01" value={s.basic} onChange={(e) => setS({ ...s, basic: e.target.value })} /></label>}
        {['allowances', 'deductions'].map((k) => (
          <div key={k} className="span2 field">
            <span className="field-label">{k === 'allowances' ? 'Allowances (added)' : 'Deductions (taken off)'}</span>
            {s[k].map((x, i) => (
              <div key={i} className="filters">
                <input placeholder={k === 'allowances' ? 'e.g. Transport, Eid bonus' : 'e.g. Advance, absence'} value={x.label} onChange={(e) => line(k, i, 'label', e.target.value)} />
                <input type="number" min="0" step="0.01" style={{ width: 120 }} value={x.amount} onChange={(e) => line(k, i, 'amount', e.target.value)} />
                <button type="button" className="link" onClick={() => setS({ ...s, [k]: s[k].filter((_, j) => j !== i) })}>remove</button>
              </div>
            ))}
            <button type="button" className="btn ghost small" onClick={() => setS({ ...s, [k]: [...s[k], { label: '', amount: '' }] })}>+ Add {k === 'allowances' ? 'allowance' : 'deduction'}</button>
          </div>
        ))}
        <label className="span2">Note<input value={s.note || ''} onChange={(e) => setS({ ...s, note: e.target.value })} /></label>
        <p className="span2"><b>Net pay: {money(slipNet({ basic, allowances: s.allowances, deductions: s.deductions }))}</b></p>
        {err && <p className="error span2">{err}</p>}
        <div className="span2 actions"><button className="btn">Save payslip</button><button type="button" className="btn ghost" onClick={onClose}>Cancel</button></div>
      </form>
    </Modal>
  );
}

function PaySlip({ slip, who, methods, onClose, onSaved }) {
  const [date, setDate] = useState(today());
  const [method, setMethod] = useState(methods.find((m) => m.name === 'Bank transfer' && m.active)?.name || methods.find((m) => m.active)?.name || 'Cash');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    setErr(''); setBusy(true);
    const { data, error } = await supabase.rpc('fin_pay_slip', { p_slip: slip.id, p_date: date, p_method: method });
    setBusy(false); if (error) setErr(error.message); else onSaved(data);
  }
  return (
    <Modal title={`Pay ${who} — ${monthLabel(slip.month)}`} onClose={onClose}>
      <p>Net pay: <b>{money(slip.net)}</b> ({slip.slip_no})</p>
      <div className="form-grid">
        <label>Paid on<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label>Method<select value={method} onChange={(e) => setMethod(e.target.value)}>{methods.filter((m) => m.active).map((m) => <option key={m.id}>{m.name}</option>)}</select></label>
      </div>
      <p className="small muted">This adds an expense "Teacher payments" with a payment voucher number. If it was a mistake, cancel that expense — the payslip goes back to "Not paid".</p>
      {err && <p className="error">{err}</p>}
      <div className="actions"><button className="btn" disabled={busy} onClick={go}>{busy ? 'Paying…' : `Mark as paid — ${money(slip.net)}`}</button><button className="btn ghost" onClick={onClose}>Cancel</button></div>
    </Modal>
  );
}

// For a staff member's own Account page: their paid payslips.
export function MyPayslips({ profile }) {
  const q = useQuery(() => supabase.from('payslips').select('*').eq('profile_id', profile.id).eq('status', 'paid').order('month', { ascending: false }));
  if (q.loading || q.error || !(q.data || []).length) return null;
  return (
    <section className="card">
      <h2>My payslips</h2>
      <table className="table">
        <thead><tr><th>Month</th><th>Payslip</th><th className="num">Net pay</th><th>Paid on</th><th /></tr></thead>
        <tbody>{q.data.map((s) => <tr key={s.id}><td>{monthLabel(s.month)}</td><td>{s.slip_no}</td><td className="num"><b>{money(s.net)}</b></td><td>{formatDate(s.paid_on)} · {s.method}</td><td><button className="btn ghost small" onClick={() => payslipPdf(s, profile)}>⬇ PDF</button></td></tr>)}</tbody>
      </table>
    </section>
  );
}
