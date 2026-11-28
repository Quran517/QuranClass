import { useState } from 'react';
import { supabase } from './supabase.js';
import { useQuery, fetchAllRows } from './data.js';
import { formatDate, today, whatsappLink, classTag } from './util.js';
import { downloadExcel, downloadPdf } from './exports.js';
import { getSettings } from './settings.js';
import FeeStatement from './FeeStatement.jsx';
import { useFeeData } from './Fees.jsx';
import { budgetRows } from './Budget.jsx';
import { money, cur, round2, monthStart, monthLabel, monthEnd, finYear, yearLabels, isMissing, NEEDS_SQL, STATUS_TEXT } from './finance.js';

const REPORTS = [
  ['ie', 'Income & expense statement', 'Totals by category for any period'],
  ['cash', 'Cash book', 'Every amount in and out, day by day, with the running balance'],
  ['recv', 'Receivables (fees owed)', 'Who owes how much, and since when — with WhatsApp reminders'],
  ['stmt', 'Student payment statement', 'Fees charged, payments and balance for one student or family'],
  ['staff', 'Staff payment summary', 'Payslips paid for each staff member, month by month'],
  ['budget', 'Budget vs actual', 'Planned against real income and spending for the year'],
];
const fmt = (rows) => rows.map((r) => Object.values(r).map((v) => (typeof v === 'number' ? money(v, false) : v)));

export default function FinReports() {
  const [rep, setRep] = useState('ie');
  const fy = finYear();
  const [from, setFrom] = useState(fy.from);
  const [to, setTo] = useState(today() < fy.to ? today() : fy.to);
  const period = `${formatDate(from)} – ${formatDate(to)}`;
  return (
    <>
      <section className="card">
        <h2>Finance reports</h2>
        <div className="report-pick">
          {REPORTS.map(([k, t, d]) => (
            <button key={k} className={`report-tile ${rep === k ? 'on' : ''}`} onClick={() => setRep(k)}><b>{t}</b><span>{d}</span></button>
          ))}
        </div>
        {['ie', 'cash', 'staff'].includes(rep) && (
          <div className="filters">
            <label className="inline">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="inline">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
            <button className="btn ghost small" onClick={() => { setFrom(monthStart()); setTo(monthEnd(monthStart())); }}>This month</button>
            <button className="btn ghost small" onClick={() => { setFrom(fy.from); setTo(fy.to); }}>This year</button>
          </div>
        )}
      </section>
      {rep === 'ie' && <IncomeStatement from={from} to={to} period={period} />}
      {rep === 'cash' && <CashBook from={from} to={to} period={period} />}
      {rep === 'recv' && <Receivables />}
      {rep === 'stmt' && <StudentStatement />}
      {rep === 'staff' && <StaffSummary from={from} to={to} period={period} />}
      {rep === 'budget' && <BudgetReport />}
    </>
  );
}

const useEntries = (from, to) => useQuery(() => fetchAllRows(() => supabase.from('fin_entries').select('*, fin_categories(name), students(full_name, student_code)').eq('status', 'active').gte('entry_date', from).lte('entry_date', to).order('entry_date').order('entry_no'))
  .then((d) => ({ data: d, error: null }), (e) => ({ data: null, error: e })), [from, to]);
const Err = ({ e }) => <section className="card"><p className="error">{isMissing(e) ? NEEDS_SQL : String(e?.message || e)}</p></section>;

function IncomeStatement({ from, to, period }) {
  const q = useEntries(from, to);
  if (q.error) return <Err e={q.error} />;
  if (q.loading) return <div className="spinner" />;
  const by = (kind) => { const m = {}; for (const e of q.data.filter((x) => x.kind === kind)) { const k = e.fin_categories?.name || 'Other'; m[k] = round2((m[k] || 0) + Number(e.amount)); } return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  const inc = by('income'), exp = by('expense');
  const ti = round2(inc.reduce((n, [, v]) => n + v, 0)), te = round2(exp.reduce((n, [, v]) => n + v, 0));
  const rows = [...inc.map(([k, v]) => ({ Section: 'Income', Category: k, Amount: v })), { Section: '', Category: 'Total income', Amount: ti },
    ...exp.map(([k, v]) => ({ Section: 'Expenses', Category: k, Amount: v })), { Section: '', Category: 'Total expenses', Amount: te }, { Section: '', Category: ti - te >= 0 ? 'SURPLUS (income − expenses)' : 'DEFICIT (income − expenses)', Amount: round2(ti - te) }];
  return (
    <section className="card">
      <div className="row-between"><h3>Income & expense statement — {period}</h3>
        <div className="actions">
          <button className="btn ghost small" onClick={() => downloadExcel(`income-expense-statement-${from}-to-${to}.xlsx`, [{ name: 'Statement', rows }], { title: 'Income & expense statement', subtitle: period })}>Excel</button>
          <button className="btn small" onClick={() => downloadPdf(`income-expense-statement-${from}-to-${to}.pdf`, { title: 'Income & expense statement', subtitle: `Period: ${period}`, orientation: 'portrait', tables: [
            { heading: 'Income', columns: ['Category', `Amount (${cur()})`], rows: [...inc.map(([k, v]) => [k, money(v, false)]), ['Total income', money(ti, false)]], compact: true },
            { heading: 'Expenses', columns: ['Category', `Amount (${cur()})`], rows: [...exp.map(([k, v]) => [k, money(v, false)]), ['Total expenses', money(te, false)]], compact: true },
            { heading: 'Result', columns: ['', `Amount (${cur()})`], rows: [['Total income', money(ti, false)], ['Total expenses', money(te, false)], [ti - te >= 0 ? 'Surplus' : 'Deficit', money(round2(ti - te), false)]], compact: true },
          ], signatures: ['Treasurer', 'Principal / Admin'] })}>⬇ PDF</button>
        </div>
      </div>
      <div className="fin-grid">
        <div><h4 className="up">Income</h4><table className="table small-table"><tbody>{inc.map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{money(v, false)}</td></tr>)}<tr className="total-row"><td><b>Total income</b></td><td className="num"><b>{money(ti)}</b></td></tr></tbody></table></div>
        <div><h4 className="dn">Expenses</h4><table className="table small-table"><tbody>{exp.map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{money(v, false)}</td></tr>)}<tr className="total-row"><td><b>Total expenses</b></td><td className="num"><b>{money(te)}</b></td></tr></tbody></table></div>
      </div>
      <p className="result-line">{ti - te >= 0 ? 'Surplus' : 'Deficit'}: <b className={ti - te >= 0 ? 'up' : 'dn'}>{money(round2(ti - te))}</b></p>
    </section>
  );
}

function CashBook({ from, to, period }) {
  const q = useEntries(from, to);
  const before = useQuery(() => fetchAllRows(() => supabase.from('fin_entries').select('kind, amount, method').eq('status', 'active').lt('entry_date', from)).then((d) => ({ data: d, error: null }), (e) => ({ data: null, error: e })), [from]);
  const [method, setMethod] = useState('all');
  if (q.error || before.error) return <Err e={q.error || before.error} />;
  if (q.loading || before.loading) return <div className="spinner" />;
  const pick = (e) => method === 'all' || (method === 'cash' ? (e.method || 'Cash') === 'Cash' : (e.method || 'Cash') !== 'Cash');
  const opening = round2(before.data.filter(pick).reduce((n, e) => n + (e.kind === 'income' ? 1 : -1) * Number(e.amount), 0));
  let bal = opening;
  const rows = q.data.filter(pick).map((e) => { bal = round2(bal + (e.kind === 'income' ? 1 : -1) * Number(e.amount)); return { Date: formatDate(e.entry_date), 'No.': e.entry_no, Details: `${e.fin_categories?.name || ''}${e.details ? ' — ' + e.details : ''}${e.students ? ` (${e.students.student_code})` : ''}`, 'Paid by / to': e.party || '', Method: e.method || '', In: e.kind === 'income' ? Number(e.amount) : '', Out: e.kind === 'expense' ? Number(e.amount) : '', Balance: bal }; });
  const tin = round2(rows.reduce((n, r) => n + (r.In || 0), 0)), tout = round2(rows.reduce((n, r) => n + (r.Out || 0), 0));
  const label = method === 'all' ? 'All money' : method === 'cash' ? 'Cash only' : 'Bank, STC Pay & card';
  const sub = `${period}   ·   ${label}   ·   Opening ${money(opening)}   ·   In ${money(tin)}   ·   Out ${money(tout)}   ·   Closing ${money(bal)}`;
  return (
    <section className="card">
      <div className="row-between"><h3>Cash book — {period}</h3>
        <div className="actions">
          <select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Money"><option value="all">All money</option><option value="cash">Cash only</option><option value="bank">Bank / STC Pay / card</option></select>
          <button className="btn ghost small" onClick={() => downloadExcel(`cash-book-${from}-to-${to}.xlsx`, [{ name: 'Cash book', rows }], { title: 'Cash book', subtitle: sub })}>Excel</button>
          <button className="btn small" onClick={() => downloadPdf(`cash-book-${from}-to-${to}.pdf`, { title: 'Cash book', subtitle: sub, tables: [{ heading: `Opening balance ${money(opening)}`, columns: Object.keys(rows[0] || { Date: '' }), rows: fmt(rows), compact: true }], signatures: ['Treasurer', 'Checked by'] })}>⬇ PDF</button>
        </div>
      </div>
      <p className="small">Opening <b>{money(opening)}</b> · In <b className="up">{money(tin)}</b> · Out <b className="dn">{money(tout)}</b> · Closing <b>{money(bal)}</b></p>
      <div className="table-wrap"><table className="table fin-table">
        <thead><tr><th>Date</th><th>No.</th><th>Details</th><th>Paid by / to</th><th>Method</th><th className="num">In</th><th className="num">Out</th><th className="num">Balance</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r['No.']}><td className="nowrap">{r.Date}</td><td>{r['No.']}</td><td>{r.Details}</td><td>{r['Paid by / to']}</td><td>{r.Method}</td><td className="num up">{r.In ? money(r.In, false) : ''}</td><td className="num dn">{r.Out ? money(r.Out, false) : ''}</td><td className="num"><b>{money(r.Balance, false)}</b></td></tr>)}</tbody>
      </table></div>
    </section>
  );
}

function Receivables() {
  const data = useFeeData();
  const [cls, setCls] = useState('all');
  if (data.error) return <Err e={data.error} />;
  if (data.loading) return <div className="spinner" />;
  const owe = data.data.rows.filter((r) => r.st.balance > 0 && (cls === 'all' || r.class_id === cls)).sort((a, b) => b.st.balance - a.st.balance);
  const buckets = ['Current', '1 month', '2 months', '3+ months'];
  const sumB = (b) => round2(owe.filter((r) => (r.age || 'Current') === b).reduce((n, r) => n + r.st.balance, 0));
  const total = round2(owe.reduce((n, r) => n + r.st.balance, 0));
  const rows = owe.map((r) => ({ 'Student ID': r.student_code, Name: r.full_name, Class: r.klass ? classTag(r.klass) : '', Guardian: r.guardian_name || '', Phone: r.guardian_phone || r.whatsapp || '', 'Unpaid fees': r.st.open.map((o) => o.ref).join(', '), 'Owed since': r.age || 'Current', Balance: r.st.balance }));
  const msg = (r) => `Assalamu Alaikum ${r.guardian_name || 'Parent'},\n\nA kind reminder that the Quran class fees for ${r.full_name} (${r.student_code}) are still unpaid: ${r.st.open.map((o) => `${o.ref} ${money(o.owe)}`).join(', ')}.\nTotal to pay: ${money(r.st.balance)}.\n\nIf you have already paid, please ignore this message. JazakAllahu khairan,\n${getSettings().school_name}`;
  return (
    <section className="card">
      <div className="row-between"><h3>Receivables — fees still owed ({owe.length} students)</h3>
        <div className="actions">
          <select value={cls} onChange={(e) => setCls(e.target.value)} aria-label="Class"><option value="all">All classes</option>{data.data.classes.map((c) => <option key={c.id} value={c.id}>{classTag(c)}</option>)}</select>
          <button className="btn ghost small" onClick={() => downloadExcel(`receivables-${today()}.xlsx`, [{ name: 'Receivables', rows }], { title: 'Receivables — fees owed', subtitle: `Total ${money(total)}` })}>Excel</button>
          <button className="btn small" onClick={() => downloadPdf(`receivables-${today()}.pdf`, { title: 'Receivables — fees owed', subtitle: `Total ${money(total)}   ·   ${buckets.map((b) => `${b}: ${money(sumB(b))}`).join('   ·   ')}`, tables: [{ heading: `${owe.length} students`, columns: Object.keys(rows[0] || { Name: '' }), rows: fmt(rows), compact: true }] })}>⬇ PDF</button>
        </div>
      </div>
      <div className="fin-kpis">{buckets.map((b) => <div key={b} className={`fin-kpi ${b === '3+ months' ? 'exp' : b === 'Current' ? 'inc' : 'due'}`}><small>Owed: {b}</small><b>{money(sumB(b))}</b><i className="muted">{owe.filter((r) => (r.age || 'Current') === b).length} students</i></div>)}</div>
      <div className="table-wrap"><table className="table fin-table">
        <thead><tr><th>Student</th><th>Class</th><th>Guardian</th><th>Unpaid fees</th><th>Since</th><th className="num">Balance</th><th /></tr></thead>
        <tbody>{owe.map((r) => (
          <tr key={r.id}><td><b>{r.full_name}</b> <span className="small muted">{r.student_code}</span></td><td className="small">{r.klass?.name}</td><td className="small">{r.guardian_name}<div className="muted">{r.guardian_phone || r.whatsapp}</div></td>
            <td className="small">{r.st.open.map((o) => `${o.ref} (${money(o.owe, false)})`).join(', ')}</td><td><span className={`fpill ${r.age === '3+ months' ? 'no' : r.age === 'Current' ? '' : 'part'}`}>{r.age || 'Current'}</span></td>
            <td className="num dn"><b>{money(r.st.balance, false)}</b></td>
            <td>{whatsappLink(r.whatsapp || r.guardian_phone, 'x') && <a className="btn whatsapp small" target="_blank" rel="noreferrer" href={whatsappLink(r.whatsapp || r.guardian_phone, msg(r))}>Remind</a>}</td></tr>
        ))}</tbody>
      </table></div>
      {!owe.length && <p className="success">Nobody owes fees. 🎉</p>}
    </section>
  );
}

function StudentStatement() {
  const data = useFeeData();
  const [q, setQ] = useState('');
  const [pick, setPick] = useState(null);
  const [family, setFamily] = useState(true);
  if (data.error) return <Err e={data.error} />;
  if (data.loading) return <div className="spinner" />;
  const found = q ? data.data.rows.filter((r) => `${r.full_name} ${r.student_code} ${r.admission_no || ''} ${r.guardian_name || ''} ${r.guardian_phone || ''}`.toLowerCase().includes(q.toLowerCase())).slice(0, 10) : [];
  const fam = pick ? data.data.rows.filter((r) => r.fam === pick.fam) : [];
  return (
    <section className="card">
      <h3>Student payment statement</h3>
      <input type="search" placeholder="Find a student by name, ID, admission no. or parent phone…" value={q} onChange={(e) => { setQ(e.target.value); setPick(null); }} />
      {!pick && found.map((r) => <div key={r.id} className="pick-row"><span className="pick-name"><b>{r.full_name}</b> <span className="muted small">{r.student_code} · {r.klass?.name}</span></span><span className="pick-meta small">Balance {money(r.st.balance)} · {STATUS_TEXT[r.status]}</span><button className="btn small" onClick={() => setPick(r)}>Show</button></div>)}
      {pick && (
        <>
          {fam.length > 1 && <label className="inline small"><input type="checkbox" checked={family} onChange={(e) => setFamily(e.target.checked)} /> Show the whole family ({fam.length} children)</label>}
          <FeeStatement students={family && fam.length > 1 ? fam : [pick]} phone={pick.whatsapp || pick.guardian_phone} guardian={pick.guardian_name} />
        </>
      )}
    </section>
  );
}

function StaffSummary({ from, to, period }) {
  const q = useQuery(async () => {
    const [s, p] = await Promise.all([
      supabase.from('payslips').select('*').neq('status', 'cancelled').gte('month', monthStart(new Date(from + 'T00:00:00'))).lte('month', to).order('month'),
      supabase.from('profiles').select('id, full_name, email, staff_code').in('role', ['teacher', 'admin']),
    ]);
    return { data: s.data && p.data ? { slips: s.data, people: p.data } : null, error: s.error || p.error };
  }, [from, to]);
  if (q.error) return <Err e={q.error} />;
  if (q.loading) return <div className="spinner" />;
  const months = [...new Set(q.data.slips.map((s) => s.month))].sort();
  const people = q.data.people.filter((p) => q.data.slips.some((s) => s.profile_id === p.id));
  const rows = people.map((p) => {
    const mine = q.data.slips.filter((s) => s.profile_id === p.id);
    return { Staff: p.full_name || p.email, 'Staff ID': p.staff_code || '', ...Object.fromEntries(months.map((m) => [monthLabel(m).replace(/ (\d{4})$/, ' $1'), round2(mine.filter((s) => s.month === m).reduce((n, s) => n + Number(s.net), 0)) || ''])),
      Paid: round2(mine.filter((s) => s.status === 'paid').reduce((n, s) => n + Number(s.net), 0)), 'Not paid': round2(mine.filter((s) => s.status === 'draft').reduce((n, s) => n + Number(s.net), 0)) };
  });
  const tp = round2(rows.reduce((n, r) => n + r.Paid, 0)), tu = round2(rows.reduce((n, r) => n + r['Not paid'], 0));
  return (
    <section className="card">
      <div className="row-between"><h3>Staff payment summary — {period}</h3>
        <div className="actions">
          <button className="btn ghost small" onClick={() => downloadExcel(`staff-payments-${from}-to-${to}.xlsx`, [{ name: 'Staff payments', rows }], { title: 'Staff payment summary', subtitle: `${period} · Paid ${money(tp)} · Not paid ${money(tu)}` })}>Excel</button>
          <button className="btn small" onClick={() => downloadPdf(`staff-payments-${from}-to-${to}.pdf`, { title: 'Staff payment summary', subtitle: `${period}   ·   Paid ${money(tp)}   ·   Not paid ${money(tu)}`, tables: [{ heading: `${rows.length} staff`, columns: Object.keys(rows[0] || { Staff: '' }), rows: fmt(rows), compact: true }] })}>⬇ PDF</button>
        </div>
      </div>
      {!rows.length ? <p className="muted">No payslips in this period.</p> : (
        <div className="table-wrap"><table className="table fin-table">
          <thead><tr>{Object.keys(rows[0]).map((k) => <th key={k} className={['Staff', 'Staff ID'].includes(k) ? '' : 'num'}>{k}</th>)}</tr></thead>
          <tbody>{rows.map((r) => <tr key={r.Staff + r['Staff ID']}>{Object.entries(r).map(([k, v]) => <td key={k} className={['Staff', 'Staff ID'].includes(k) ? '' : 'num'}>{typeof v === 'number' ? money(v, false) : v}</td>)}</tr>)}</tbody>
        </table></div>
      )}
      <p className="small"><b className="up">Paid {money(tp)}</b> · <b className="dn">Not paid {money(tu)}</b></p>
    </section>
  );
}

function BudgetReport() {
  const [year, setYear] = useState(finYear().label);
  const q = useQuery(() => budgetRows(year).then((d) => ({ data: d, error: null }), (e) => ({ data: null, error: e })), [year]);
  if (q.error) return <Err e={q.error} />;
  if (q.loading) return <div className="spinner" />;
  const rows = q.data.rows.map((r) => ({ Type: r.kind === 'income' ? 'Income' : 'Expense', Category: r.name, Budget: r.budget, Actual: r.actual, Difference: round2(r.actual - r.budget), '% used': r.budget ? Math.round((r.actual / r.budget) * 100) + '%' : '' }));
  return (
    <section className="card">
      <div className="row-between"><h3>Budget vs actual — {year}</h3>
        <div className="actions">
          <select value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year">{yearLabels().map((y) => <option key={y} value={y}>Year {y}</option>)}</select>
          <button className="btn ghost small" onClick={() => downloadExcel(`budget-vs-actual-${year}.xlsx`, [{ name: 'Budget vs actual', rows }], { title: `Budget vs actual — ${year}` })}>Excel</button>
          <button className="btn small" onClick={() => downloadPdf(`budget-vs-actual-${year}.pdf`, { title: `Budget vs actual — ${year}`, tables: [{ heading: 'By category', columns: Object.keys(rows[0] || { Category: '' }), rows: fmt(rows), compact: true }], signatures: ['Treasurer', 'Principal / Admin'] })}>⬇ PDF</button>
        </div>
      </div>
      <div className="table-wrap"><table className="table fin-table">
        <thead><tr><th>Type</th><th>Category</th><th className="num">Budget</th><th className="num">Actual</th><th className="num">Difference</th><th className="num">% used</th></tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}><td>{r.Type}</td><td>{r.Category}</td><td className="num">{money(r.Budget, false)}</td><td className="num">{money(r.Actual, false)}</td><td className={`num ${r.Type === 'Expense' && r.Difference > 0 ? 'dn' : ''}`}>{money(r.Difference, false)}</td><td className="num">{r['% used']}</td></tr>)}</tbody>
      </table></div>
      <p className="small muted">Set the budget on the Budget page.</p>
    </section>
  );
}
