import { needsSql } from './finance.js';
import { useState } from 'react';
import { supabase } from './supabase.js';
import { useQuery, fetchAllRows } from './data.js';
import { downloadExcel, downloadPdf } from './exports.js';
import { money, cur, round2, finYear, yearLabels, fetchCategories, isMissing, NEEDS_SQL, monthLabel, monthEnd } from './finance.js';

export async function budgetRows(year) {
  const fy = finYear(year);
  const [cats, bud, ent] = await Promise.all([
    fetchCategories().then((r) => r.data || []),
    supabase.from('fin_budget').select('*').eq('year_label', year).then((r) => { if (r.error) throw r.error; return r.data; }),
    fetchAllRows(() => supabase.from('fin_entries').select('kind, category_id, amount, entry_date').eq('status', 'active').gte('entry_date', fy.from).lte('entry_date', fy.to)),
  ]);
  const rows = cats.map((c) => {
    const actual = round2(ent.filter((e) => e.category_id === c.id).reduce((n, e) => n + Number(e.amount), 0));
    const budget = Number(bud.find((b) => b.category_id === c.id)?.amount || 0);
    const monthly = fy.months.map((m) => round2(ent.filter((e) => e.category_id === c.id && e.entry_date >= m && e.entry_date <= monthEnd(m)).reduce((n, e) => n + Number(e.amount), 0)));
    return { ...c, budget, actual, monthly };
  }).filter((r) => r.active || r.budget || r.actual);
  return { rows, fy };
}

export default function Budget() {
  const [year, setYear] = useState(finYear().label);
  const q = useQuery(() => budgetRows(year).then((d) => ({ data: d, error: null }), (e) => ({ data: null, error: e })), [year]);
  const [edits, setEdits] = useState({});
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  if (q.error) return <section className="card"><h2>Budget</h2><p className="error">{isMissing(q.error) ? needsSql(q.error) : String(q.error.message || q.error)}</p></section>;
  const rows = q.data?.rows || [];
  const fy = q.data?.fy || finYear(year);
  const val = (r) => (edits[r.id] !== undefined ? edits[r.id] : r.budget);
  async function save() {
    setErr(''); setMsg('');
    const up = Object.entries(edits).map(([category_id, amount]) => ({ year_label: year, category_id, amount: round2(amount) }));
    if (!up.length) return;
    const { error } = await supabase.from('fin_budget').upsert(up, { onConflict: 'year_label,category_id' });
    if (error) setErr(error.message); else { setMsg('Budget saved.'); setEdits({}); q.reload(); }
  }
  const tot = (kind, k) => round2(rows.filter((r) => r.kind === kind).reduce((n, r) => n + Number(k === 'budget' ? val(r) || 0 : r[k]), 0));
  const xrows = () => rows.map((r) => ({ Type: r.kind === 'income' ? 'Income' : 'Expense', Category: r.name, Budget: Number(val(r) || 0), Actual: r.actual, Difference: round2(r.actual - Number(val(r) || 0)), '% used': Number(val(r)) ? Math.round((r.actual / Number(val(r))) * 100) : '' }));
  return (
    <>
      <section className="card">
        <div className="row-between">
          <div><h2>Budget</h2><p className="small muted">Plan the year by category, then see the actual income and spending against it. Year {fy.label}: {monthLabel(fy.months[0])} – {monthLabel(fy.months[11])}.</p></div>
          <div className="actions">
            <button className="btn ghost small" onClick={() => downloadExcel(`budget-${year}.xlsx`, [{ name: 'Budget vs actual', rows: xrows() }], { title: `Budget vs actual — ${year}` })}>Excel</button>
            <button className="btn ghost small" onClick={() => downloadPdf(`budget-${year}.pdf`, { title: `Budget vs actual — ${year}`, subtitle: `Income: budget ${money(tot('income', 'budget'))}, actual ${money(tot('income', 'actual'))}   ·   Expenses: budget ${money(tot('expense', 'budget'))}, actual ${money(tot('expense', 'actual'))}`, tables: [{ heading: 'By category', columns: Object.keys(xrows()[0] || { Category: '' }), rows: xrows().map((r) => Object.values(r).map((v, i) => (typeof v === 'number' && i < 5 ? money(v, false) : v))), compact: true }] })}>PDF</button>
          </div>
        </div>
        <div className="filters">
          <select value={year} onChange={(e) => { setYear(e.target.value); setEdits({}); }} aria-label="Year">{yearLabels().map((y) => <option key={y} value={y}>Year {y}</option>)}</select>
          <button className="btn" disabled={!Object.keys(edits).length} onClick={save}>Save budget</button>
        </div>
        {msg && <p className="success">{msg}</p>}{err && <p className="error">{err}</p>}
      </section>
      {!q.data ? <div className="spinner" /> : ['income', 'expense'].map((kind) => (
        <section key={kind} className="card">
          <h3 className={kind === 'income' ? 'up' : 'dn'}>{kind === 'income' ? 'Income' : 'Expenses'}</h3>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Category</th><th className="num">Budget ({cur()})</th><th className="num">Actual</th><th className="num">{kind === 'income' ? 'Still to come' : 'Left to spend'}</th><th style={{ width: '28%' }}>Used</th></tr></thead>
              <tbody>
                {rows.filter((r) => r.kind === kind).map((r) => {
                  const b = Number(val(r) || 0); const used = b ? Math.round((r.actual / b) * 100) : 0;
                  const over = kind === 'expense' && b && r.actual > b;
                  return (
                    <tr key={r.id}>
                      <td>{r.name}</td>
                      <td className="num"><input type="number" min="0" step="1" style={{ width: 110, textAlign: 'right' }} value={val(r)} onChange={(e) => setEdits({ ...edits, [r.id]: e.target.value })} /></td>
                      <td className="num">{money(r.actual, false)}</td>
                      <td className={`num ${over ? 'dn' : ''}`}>{money(round2(b - r.actual), false)}</td>
                      <td>{b ? <div className="budget-bar"><span className={over ? 'over' : used > 85 && kind === 'expense' ? 'warn' : ''} style={{ width: `${Math.min(100, used)}%` }} /><em>{used}%</em></div> : <span className="small muted">no budget</span>}</td>
                    </tr>
                  );
                })}
                <tr className="total-row"><td><b>Total</b></td><td className="num"><b>{money(tot(kind, 'budget'), false)}</b></td><td className="num"><b>{money(tot(kind, 'actual'), false)}</b></td><td className="num"><b>{money(round2(tot(kind, 'budget') - tot(kind, 'actual')), false)}</b></td><td /></tr>
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {q.data && <FeeCalculator year={year} rows={rows} val={val} />}
      {!q.loading && <p className="small muted">Planned result for the year: {money(round2(tot('income', 'budget') - tot('expense', 'budget')))} · Actual so far: {money(round2(tot('income', 'actual') - tot('expense', 'actual')))}</p>}
    </>
  );
}

// Work out the student fee from the yearly budget:
// (planned expenses − other planned income) ÷ students ÷ months of classes
function FeeCalculator({ year, rows, val }) {
  const count = useQuery(() => supabase.from('students').select('id', { count: 'exact', head: true }).eq('status', 'approved').then((r) => ({ data: r.count || 0, error: r.error })));
  const expenses = round2(rows.filter((r) => r.kind === 'expense').reduce((n, r) => n + Number(val(r) || 0), 0));
  const other = round2(rows.filter((r) => r.kind === 'income' && r.name !== 'Student fees').reduce((n, r) => n + Number(val(r) || 0), 0));
  const [students, setStudents] = useState('');
  const [months, setMonths] = useState(10);
  const [roundTo, setRoundTo] = useState(5);
  const [extra, setExtra] = useState(0);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const n = Number(students || count.data || 0);
  const need = round2(expenses * (1 + Number(extra || 0) / 100) - other);
  const perYear = n ? need / n : 0;
  const perMonth = months ? perYear / Number(months) : 0;
  const up = (v) => (roundTo > 0 ? Math.ceil(v / roundTo) * roundTo : round2(v));
  async function makePlan(frequency) {
    setErr(''); setMsg('');
    const amount = frequency === 'monthly' ? up(perMonth) : up(perYear);
    const { error } = await supabase.from('fee_plans').insert({ name: frequency === 'monthly' ? `Monthly fee ${year}` : `Yearly fee ${year}`, amount, frequency });
    if (error) setErr(error.message); else setMsg(`Fee plan "${frequency === 'monthly' ? 'Monthly' : 'Yearly'} fee ${year}" (${money(amount)}) created. Use Fees & collection → Create fees to charge it.`);
  }
  return (
    <section className="card">
      <h3>Student fee from the budget</h3>
      <p className="small muted">Works out how much each student should pay so the year's planned expenses are covered. Brother / sister discounts and free places lower the total collected — add a little extra % to cover them.</p>
      <div className="form-grid">
        <label>Planned expenses for {year}<input value={money(expenses)} readOnly /></label>
        <label>Other planned income (donations etc.)<input value={money(other)} readOnly /></label>
        <label>Enrolled students<input type="number" min="1" value={students} placeholder={String(count.data ?? '')} onChange={(e) => setStudents(e.target.value)} /></label>
        <label>Months of classes in the year<input type="number" min="1" max="12" value={months} onChange={(e) => setMonths(e.target.value)} /></label>
        <label>Extra % (for discounts & unpaid fees)<input type="number" min="0" max="100" value={extra} onChange={(e) => setExtra(e.target.value)} /></label>
        <label>Round up to<select value={roundTo} onChange={(e) => setRoundTo(Number(e.target.value))}><option value={0}>No rounding</option><option value={1}>1</option><option value={5}>5</option><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option></select></label>
      </div>
      {!expenses ? <p className="notice-inline small">First enter the expense budget above and press <b>Save budget</b>.</p> : (
        <div className="fin-kpis" style={{ marginTop: 12 }}>
          <div className="fin-kpi bal"><small>To collect from fees</small><b>{money(Math.max(0, need))}</b><i className="muted">expenses{Number(extra) ? ` + ${extra}%` : ''} − other income</i></div>
          <div className="fin-kpi inc"><small>Fee per student — per year</small><b>{money(up(perYear))}</b><i className="muted">{n} students</i></div>
          <div className="fin-kpi due"><small>Fee per student — per month</small><b>{money(up(perMonth))}</b><i className="muted">over {months} months</i></div>
          <div className="fin-kpi exp"><small>Collected at this fee</small><b>{money(up(perMonth) * n * Number(months))}</b><i className="muted">if every student pays in full</i></div>
        </div>
      )}
      {expenses > 0 && n > 0 && (
        <div className="actions">
          <button className="btn" onClick={() => makePlan('monthly')}>Create monthly fee plan — {money(up(perMonth))}</button>
          <button className="btn ghost" onClick={() => makePlan('yearly')}>Create yearly fee plan — {money(up(perYear))}</button>
        </div>
      )}
      {msg && <p className="success">{msg}</p>}{err && <p className="error">{err}</p>}
    </section>
  );
}
