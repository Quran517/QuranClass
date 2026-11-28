import { needsSql } from './finance.js';
import { useMemo, useState } from 'react';
import { supabase } from './supabase.js';
import { useQuery, fetchAllRows } from './data.js';
import { formatDate, today } from './util.js';
import { downloadExcel, downloadPdf } from './exports.js';
import Modal from './Modal.jsx';
import {
  money, cur, round2, monthStart, monthLabel, monthEnd, finYear, yearLabels, fetchCategories, fetchMethods,
  isMissing, NEEDS_SQL, fileToData, openFile,
} from './finance.js';

// Income & expenses: every amount in and out.
export default function Finance({ profile }) {
  const admin = profile.role === 'admin';
  const [view, setView] = useState('overview');
  const [year, setYear] = useState(finYear().label);
  const fy = finYear(year);
  const [month, setMonth] = useState(monthStart());
  const cats = useQuery(fetchCategories);
  const methods = useQuery(fetchMethods);
  const entries = useQuery(() => fetchAllRows(() => supabase.from('fin_entries')
    .select('*, fin_categories(name, kind), students(full_name, student_code), fin_files(id, name, mime)')
    .gte('entry_date', fy.from).lte('entry_date', fy.to).order('entry_date', { ascending: false }).order('entry_no', { ascending: false }))
    .then((d) => ({ data: d, error: null }), (e) => ({ data: null, error: e })), [year]);
  const closed = useQuery(() => supabase.from('fin_closed').select('month'));
  const [adding, setAdding] = useState(null);
  const [open, setOpen] = useState(null);

  const all = entries.data || [];
  const active = all.filter((e) => e.status === 'active');
  const inMonth = (e) => e.entry_date >= month && e.entry_date <= monthEnd(month);
  const sum = (list, kind) => round2(list.filter((e) => e.kind === kind).reduce((n, e) => n + Number(e.amount), 0));
  const mIn = sum(active.filter(inMonth), 'income');
  const mOut = sum(active.filter(inMonth), 'expense');
  const prevM = fy.months[fy.months.indexOf(month) - 1];
  const pIn = prevM ? sum(active.filter((e) => e.entry_date >= prevM && e.entry_date <= monthEnd(prevM)), 'income') : null;
  const pOut = prevM ? sum(active.filter((e) => e.entry_date >= prevM && e.entry_date <= monthEnd(prevM)), 'expense') : null;
  const balanceYear = round2(sum(active, 'income') - sum(active, 'expense'));
  const isClosed = (m) => (closed.data || []).some((c) => c.month === m);

  const perMonth = fy.months.map((m) => {
    const l = active.filter((e) => e.entry_date >= m && e.entry_date <= monthEnd(m));
    return { m, inc: sum(l, 'income'), exp: sum(l, 'expense') };
  });
  const maxBar = Math.max(1, ...perMonth.map((x) => Math.max(x.inc, x.exp)));
  const byCat = (kind) => {
    const map = {};
    for (const e of active.filter(inMonth).filter((x) => x.kind === kind)) { const k = e.fin_categories?.name || 'Other'; map[k] = round2((map[k] || 0) + Number(e.amount)); }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  };

  if (entries.error || cats.error) {
    return <section className="card"><h2>Income & expenses</h2><p className="error">{isMissing(entries.error || cats.error) ? needsSql(entries.error || cats.error) : (entries.error || cats.error)}</p></section>;
  }

  const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);
  const delta = (a, b, good) => {
    const p = pct(a, b); if (p == null) return <i className="muted">—</i>;
    const up = p >= 0; return <i className={(up === good) ? 'up' : 'dn'}>{up ? '▲' : '▼'} {Math.abs(p)}% vs {monthLabel(prevM).split(' ')[0]}</i>;
  };

  return (
    <>
      <section className="card">
        <div className="row-between">
          <div>
            <h2>Income & expenses</h2>
            <p className="small muted">Money in and money out — every amount in {cur()}. Entries are never deleted; a mistake is cancelled with a reason.</p>
          </div>
          <div className="actions">
            <button className="btn" onClick={() => setAdding({ kind: 'income' })}>+ Add income</button>
            <button className="btn maroon" onClick={() => setAdding({ kind: 'expense' })}>+ Add expense</button>
          </div>
        </div>
        <div className="seg-tabs">
          {[['overview', 'Overview'], ['entries', 'All entries'], ['setup', 'Categories & payment methods'], ['close', 'Month closing']].map(([k, l]) => (
            <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>
          ))}
        </div>
        <div className="filters">
          <select value={year} onChange={(e) => { setYear(e.target.value); setMonth(finYear(e.target.value).months[0]); }} aria-label="Year">
            {yearLabels().map((y) => <option key={y} value={y}>Year {y}</option>)}
          </select>
          {view !== 'setup' && view !== 'close' && (
            <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
              {fy.months.map((m) => <option key={m} value={m}>{monthLabel(m)}{isClosed(m) ? ' 🔒' : ''}</option>)}
            </select>
          )}
        </div>
      </section>

      {!entries.data ? <div className="spinner" /> : view === 'overview' ? (
        <>
          <div className="fin-kpis">
            <div className="fin-kpi inc"><small>Income — {monthLabel(month)}</small><b>{money(mIn)}</b>{delta(mIn, pIn, true)}</div>
            <div className="fin-kpi exp"><small>Expenses — {monthLabel(month)}</small><b>{money(mOut)}</b>{delta(mOut, pOut, false)}</div>
            <div className="fin-kpi bal"><small>Net this month</small><b className={mIn - mOut < 0 ? 'dn' : ''}>{money(round2(mIn - mOut))}</b><i className="muted">Year so far: {money(balanceYear)}</i></div>
            <div className="fin-kpi due"><small>Entries this month</small><b>{active.filter(inMonth).length}</b><i className="muted">{all.filter(inMonth).length - active.filter(inMonth).length} cancelled</i></div>
          </div>
          <div className="fin-grid">
            <section className="card">
              <h3>Income vs expenses — {fy.label}</h3>
              <div className="fin-chart">
                {perMonth.map((x) => (
                  <button key={x.m} className={`fin-month ${x.m === month ? 'on' : ''}`} onClick={() => setMonth(x.m)} title={`${monthLabel(x.m)}: income ${money(x.inc)}, expenses ${money(x.exp)}`}>
                    <span className="bars"><i className="a" style={{ height: `${(x.inc / maxBar) * 100}%` }} /><i className="b" style={{ height: `${(x.exp / maxBar) * 100}%` }} /></span>
                    <em>{new Date(x.m + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short' })}</em>
                  </button>
                ))}
              </div>
              <div className="fin-legend"><span className="a">Income</span><span className="b">Expenses</span><span className="muted small">Tap a month to see it</span></div>
            </section>
            <section className="card">
              <h3>Where the money comes from</h3>
              <CatBars rows={byCat('income')} color="#23502f" />
              <h3 style={{ marginTop: 16 }}>Where the money goes</h3>
              <CatBars rows={byCat('expense')} color="#742224" />
            </section>
          </div>
          <EntryTable title={`Entries — ${monthLabel(month)}`} rows={all.filter(inMonth)} onOpen={setOpen} />
        </>
      ) : view === 'entries' ? (
        <AllEntries rows={all} cats={cats.data || []} onOpen={setOpen} year={fy.label} />
      ) : view === 'setup' ? (
        <Setup cats={cats} methods={methods} />
      ) : (
        <Closing fy={fy} closed={closed} admin={admin} active={active} />
      )}

      {adding && (
        <EntryForm kind={adding.kind} cats={cats.data || []} methods={methods.data || []} isClosed={isClosed}
          onClose={() => setAdding(null)} onSaved={() => { setAdding(null); entries.reload(); }} />
      )}
      {open && <EntryDetail entry={open} isClosed={isClosed} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); entries.reload(); }} />}
    </>
  );
}

function CatBars({ rows, color }) {
  const max = Math.max(1, ...rows.map(([, v]) => v));
  if (!rows.length) return <p className="small muted">Nothing this month.</p>;
  return (
    <div className="cat-bars">
      {rows.map(([k, v]) => (
        <div key={k}><em>{k}</em><span className="tr"><span style={{ width: `${(v / max) * 100}%`, background: color }} /></span><b>{money(v, false)}</b></div>
      ))}
    </div>
  );
}

export function EntryTable({ title, rows, onOpen, actions }) {
  return (
    <section className="card">
      <div className="row-between"><h3>{title}</h3>{actions}</div>
      {!rows.length ? <p className="muted small">No entries.</p> : (
        <div className="table-wrap">
          <table className="table fin-table">
            <thead><tr><th>Date</th><th>No.</th><th>Type</th><th>Category</th><th>Details</th><th>Paid by / to</th><th>Method</th><th className="num">Amount ({cur()})</th></tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className={`clickable ${e.status === 'cancelled' ? 'cancelled' : ''}`} onClick={() => onOpen(e)}>
                  <td className="nowrap">{formatDate(e.entry_date)}</td>
                  <td className="nowrap">{e.entry_no}{(e.fin_files || []).length > 0 && ' 📎'}</td>
                  <td>{e.status === 'cancelled' ? <span className="fpill no">Cancelled</span> : <span className={`fpill ${e.kind === 'income' ? 'ok' : 'exp'}`}>{e.kind === 'income' ? 'Income' : 'Expense'}</span>}</td>
                  <td>{e.fin_categories?.name || '—'}</td>
                  <td>{e.details}{e.students ? <span className="small muted"> · {e.students.full_name} ({e.students.student_code})</span> : null}</td>
                  <td>{e.party}</td>
                  <td>{e.method}</td>
                  <td className={`num ${e.kind === 'income' ? 'up' : 'dn'}`}>{e.kind === 'income' ? '+' : '−'}{money(e.amount, false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AllEntries({ rows, cats, onOpen, year }) {
  const [kind, setKind] = useState('all');
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [showCancelled, setShowCancelled] = useState(false);
  const list = rows.filter((e) => (kind === 'all' || e.kind === kind) && (cat === 'all' || e.category_id === cat) && (showCancelled || e.status === 'active')
    && (!q || `${e.entry_no} ${e.details} ${e.party} ${e.reference} ${e.students?.full_name || ''} ${e.students?.student_code || ''}`.toLowerCase().includes(q.toLowerCase())));
  const totIn = round2(list.filter((e) => e.kind === 'income' && e.status === 'active').reduce((n, e) => n + Number(e.amount), 0));
  const totOut = round2(list.filter((e) => e.kind === 'expense' && e.status === 'active').reduce((n, e) => n + Number(e.amount), 0));
  const xrows = () => list.map((e) => ({
    Date: formatDate(e.entry_date), 'No.': e.entry_no, Type: e.status === 'cancelled' ? 'Cancelled' : e.kind === 'income' ? 'Income' : 'Expense',
    Category: e.fin_categories?.name || '', Details: e.details || '', Student: e.students ? `${e.students.full_name} (${e.students.student_code})` : '',
    'Paid by / to': e.party || '', Method: e.method || '', Reference: e.reference || '',
    Income: e.kind === 'income' && e.status === 'active' ? Number(e.amount) : '', Expense: e.kind === 'expense' && e.status === 'active' ? Number(e.amount) : '',
  }));
  return (
    <>
      <section className="card">
        <div className="filters">
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type"><option value="all">Income and expenses</option><option value="income">Income only</option><option value="expense">Expenses only</option></select>
          <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category"><option value="all">All categories</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.kind === 'income' ? '↑' : '↓'} {c.name}</option>)}</select>
          <input type="search" placeholder="Search no., details, name…" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="inline small"><input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> Show cancelled</label>
        </div>
        <p className="small"><b className="up">Income {money(totIn)}</b> · <b className="dn">Expenses {money(totOut)}</b> · <b>Net {money(round2(totIn - totOut))}</b> — {list.length} entries in {year}</p>
      </section>
      <EntryTable title="All entries" rows={list} onOpen={onOpen} actions={(
        <div className="actions">
          <button className="btn ghost small" onClick={() => downloadExcel(`income-expenses-${year}.xlsx`, [{ name: 'Entries', rows: xrows() }], { title: `Income & expenses — ${year}`, subtitle: `Income ${money(totIn)} · Expenses ${money(totOut)} · Net ${money(round2(totIn - totOut))}` })}>Excel</button>
          <button className="btn ghost small" onClick={() => downloadPdf(`income-expenses-${year}.pdf`, { title: `Income & expenses — ${year}`, subtitle: `Income ${money(totIn)}   ·   Expenses ${money(totOut)}   ·   Net ${money(round2(totIn - totOut))}`, tables: [{ heading: `${list.length} entries`, columns: Object.keys(xrows()[0] || { Date: '' }), rows: xrows().map((r) => Object.values(r).map((v) => (typeof v === 'number' ? money(v, false) : v))), compact: true }] })}>PDF</button>
        </div>
      )} />
    </>
  );
}

export function EntryForm({ kind, cats, methods, isClosed, preset = {}, onClose, onSaved }) {
  const myCats = cats.filter((c) => c.kind === kind && c.active);
  const [f, setF] = useState({
    entry_date: today(), category_id: preset.category_id || myCats[0]?.id || '', amount: preset.amount || '', method: methods.find((m) => m.active)?.name || 'Cash',
    party: preset.party || '', details: preset.details || '', reference: '', student_id: preset.student_id || '',
  });
  const [files, setFiles] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const students = useQuery(() => (kind === 'income' ? supabase.from('students').select('id, full_name, student_code').eq('status', 'approved').order('full_name') : Promise.resolve({ data: [] })), [kind]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function addFiles(e) {
    setErr('');
    try { const out = []; for (const file of e.target.files) out.push({ name: file.name, ...(await fileToData(file)) }); setFiles([...files, ...out]); } catch (x) { setErr(x.message); }
    e.target.value = '';
  }
  async function save(e) {
    e.preventDefault(); setErr('');
    const amt = round2(f.amount);
    if (!(amt > 0)) { setErr('Please enter an amount above 0.'); return; }
    if (isClosed(monthStart(new Date(f.entry_date + 'T00:00:00')))) { setErr('That month is closed. Choose another date or ask the admin to reopen the month.'); return; }
    setBusy(true);
    const { data, error } = await supabase.from('fin_entries').insert({
      kind, entry_date: f.entry_date, category_id: f.category_id || null, amount: amt, method: f.method || null,
      party: f.party.trim() || null, details: f.details.trim() || null, reference: f.reference.trim() || null, student_id: f.student_id || null,
    }).select('id, entry_no').single();
    if (!error && files.length) {
      const { error: e2 } = await supabase.from('fin_files').insert(files.map((x) => ({ entry_id: data.id, name: x.name, mime: x.mime, size: x.size, data: x.data })));
      if (e2) { setBusy(false); setErr(`Saved as ${data.entry_no}, but the attachment failed: ${e2.message}`); return; }
    }
    setBusy(false);
    if (error) setErr(isMissing(error) ? needsSql(error) : error.message); else onSaved(data);
  }
  return (
    <Modal title={kind === 'income' ? 'Add income' : 'Add expense'} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <label>Date<input type="date" required value={f.entry_date} onChange={set('entry_date')} /></label>
        <label>Amount ({cur()}) *<input type="number" min="0.01" step="0.01" required inputMode="decimal" value={f.amount} onChange={set('amount')} autoFocus /></label>
        <label>Category
          <select value={f.category_id} onChange={set('category_id')}>{myCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </label>
        <label>Payment method
          <select value={f.method} onChange={set('method')}>{methods.filter((m) => m.active).map((m) => <option key={m.id}>{m.name}</option>)}</select>
        </label>
        <label>{kind === 'income' ? 'Received from' : 'Paid to'}<input value={f.party} onChange={set('party')} placeholder={kind === 'income' ? 'Parent / donor name' : 'Shop, landlord, person…'} /></label>
        <label>Reference<input value={f.reference} onChange={set('reference')} placeholder="Bank ref, cheque no., bill no." /></label>
        {kind === 'income' && (
          <label className="span2">Student (for fees)
            <select value={f.student_id} onChange={set('student_id')}>
              <option value="">— not for a student —</option>
              {(students.data || []).map((s) => <option key={s.id} value={s.id}>{s.full_name} ({s.student_code})</option>)}
            </select>
          </label>
        )}
        <label className="span2">Details<input value={f.details} onChange={set('details')} placeholder={kind === 'income' ? 'e.g. November fee, donation for prizes' : 'e.g. Classroom rent — November'} /></label>
        <div className="span2 field">
          <span className="field-label">Attachments — photo of the bill / receipt / bank slip (optional)</span>
          <input type="file" accept="image/*,application/pdf" multiple onChange={addFiles} />
          {files.map((x, i) => <div key={i} className="small">📎 {x.name} <button type="button" className="link" onClick={() => setFiles(files.filter((_, j) => j !== i))}>remove</button></div>)}
        </div>
        {err && <p className="error span2">{err}</p>}
        <div className="span2 actions">
          <button className={`btn ${kind === 'expense' ? 'maroon' : ''}`} disabled={busy}>{busy ? 'Saving…' : kind === 'income' ? 'Save income' : 'Save expense'}</button>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

export function EntryDetail({ entry: e, isClosed, onClose, onChanged }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const files = useQuery(() => supabase.from('fin_files').select('id, name, mime, size').eq('entry_id', e.id), [e.id]);
  const [adding, setAdding] = useState(false);
  const locked = isClosed(monthStart(new Date(e.entry_date + 'T00:00:00')));
  async function cancel() {
    setErr(''); if (!reason.trim()) { setErr('Please write why this entry is cancelled.'); return; }
    setBusy(true); const { error } = await supabase.rpc('fin_cancel', { p_entry: e.id, p_reason: reason });
    setBusy(false); if (error) setErr(error.message); else onChanged();
  }
  async function attach(ev) {
    setErr(''); setAdding(true);
    try { for (const file of ev.target.files) { const x = await fileToData(file); const { error } = await supabase.from('fin_files').insert({ entry_id: e.id, name: file.name, ...x }); if (error) throw error; } files.reload(); } catch (x) { setErr(x.message); }
    setAdding(false); ev.target.value = '';
  }
  return (
    <Modal title={`${e.entry_no} — ${e.kind === 'income' ? 'Income' : 'Expense'}`} onClose={onClose}>
      <dl className="details">
        <dt>Date</dt><dd>{formatDate(e.entry_date)}</dd>
        <dt>Amount</dt><dd><b className={e.kind === 'income' ? 'up' : 'dn'}>{money(e.amount)}</b></dd>
        <dt>Category</dt><dd>{e.fin_categories?.name || '—'}</dd>
        <dt>{e.kind === 'income' ? 'Received from' : 'Paid to'}</dt><dd>{e.party || '—'}</dd>
        {e.students && <><dt>Student</dt><dd>{e.students.full_name} ({e.students.student_code})</dd></>}
        <dt>Method</dt><dd>{e.method || '—'}</dd>
        <dt>Reference</dt><dd>{e.reference || '—'}</dd>
        <dt>Details</dt><dd>{e.details || '—'}</dd>
        <dt>Status</dt><dd>{e.status === 'cancelled' ? <span className="fpill no">Cancelled — {e.cancel_reason}</span> : <span className="fpill ok">Active</span>}{locked && ' 🔒 month closed'}</dd>
      </dl>
      <h3>Attachments</h3>
      {(files.data || []).length === 0 && <p className="small muted">No attachments.</p>}
      {(files.data || []).map((x) => <div key={x.id}><button className="link" onClick={() => openFile(x.id)}>📎 {x.name}</button> <span className="small muted">{Math.round((x.size || 0) / 1024)} KB</span></div>)}
      {e.status === 'active' && <label className="small">Add attachment <input type="file" accept="image/*,application/pdf" multiple onChange={attach} disabled={adding} /></label>}
      {e.status === 'active' && !locked && (
        <div className="cancel-box">
          <h3>Cancel this entry</h3>
          <p className="small muted">Use this for a mistake. The entry stays in the history, marked cancelled, and no longer counts in totals.</p>
          <input placeholder="Reason (required) — e.g. entered twice" value={reason} onChange={(x) => setReason(x.target.value)} />
          <button className="btn danger ghost" disabled={busy} onClick={cancel}>{busy ? 'Cancelling…' : 'Cancel entry'}</button>
        </div>
      )}
      {err && <p className="error">{err}</p>}
    </Modal>
  );
}

function Setup({ cats, methods }) {
  const [err, setErr] = useState('');
  const [nc, setNc] = useState({ kind: 'expense', name: '' });
  const [nm, setNm] = useState('');
  async function run(p) { setErr(''); const { error } = await p; if (error) setErr(/duplicate|unique/.test(error.message) ? 'That name already exists.' : error.message); cats.reload(); methods.reload(); }
  return (
    <div className="fin-grid">
      <section className="card">
        <h3>Categories</h3>
        <p className="small muted">Untick a category to hide it from new entries (old entries keep it).</p>
        {['income', 'expense'].map((k) => (
          <div key={k}>
            <h4 className={k === 'income' ? 'up' : 'dn'}>{k === 'income' ? 'Income' : 'Expenses'}</h4>
            {(cats.data || []).filter((c) => c.kind === k).map((c) => (
              <label key={c.id} className="inline small setup-row"><input type="checkbox" checked={c.active} onChange={(e) => run(supabase.from('fin_categories').update({ active: e.target.checked }).eq('id', c.id))} /> {c.name}</label>
            ))}
          </div>
        ))}
        <form className="filters" onSubmit={(e) => { e.preventDefault(); if (nc.name.trim()) run(supabase.from('fin_categories').insert({ kind: nc.kind, name: nc.name.trim(), sort: 50 })).then(() => setNc({ ...nc, name: '' })); }}>
          <select value={nc.kind} onChange={(e) => setNc({ ...nc, kind: e.target.value })}><option value="income">Income</option><option value="expense">Expense</option></select>
          <input placeholder="New category name" value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} />
          <button className="btn">Add</button>
        </form>
      </section>
      <section className="card">
        <h3>Payment methods</h3>
        {(methods.data || []).map((m) => (
          <label key={m.id} className="inline small setup-row"><input type="checkbox" checked={m.active} onChange={(e) => run(supabase.from('fin_methods').update({ active: e.target.checked }).eq('id', m.id))} /> {m.name}</label>
        ))}
        <form className="filters" onSubmit={(e) => { e.preventDefault(); if (nm.trim()) run(supabase.from('fin_methods').insert({ name: nm.trim(), sort: 50 })).then(() => setNm('')); }}>
          <input placeholder="New method, e.g. Apple Pay" value={nm} onChange={(e) => setNm(e.target.value)} />
          <button className="btn">Add</button>
        </form>
        {err && <p className="error">{err}</p>}
      </section>
    </div>
  );
}

function Closing({ fy, closed, admin, active }) {
  const [err, setErr] = useState('');
  const isClosed = (m) => (closed.data || []).some((c) => c.month === m);
  async function toggle(m) {
    setErr('');
    const { error } = isClosed(m) ? await supabase.from('fin_closed').delete().eq('month', m) : await supabase.from('fin_closed').insert({ month: m });
    if (error) setErr(error.message); closed.reload();
  }
  const totals = useMemo(() => Object.fromEntries(fy.months.map((m) => {
    const l = active.filter((e) => e.entry_date >= m && e.entry_date <= monthEnd(m));
    const inc = round2(l.filter((e) => e.kind === 'income').reduce((n, e) => n + Number(e.amount), 0));
    const exp = round2(l.filter((e) => e.kind === 'expense').reduce((n, e) => n + Number(e.amount), 0));
    return [m, { inc, exp, n: l.length }];
  })), [fy.months, active]);
  return (
    <section className="card">
      <h3>Month closing</h3>
      <p className="small muted">When a month has been checked (cash counted, bank matched), close it. Nobody can then add, change or cancel entries in that month. {admin ? 'Only the admin can close or reopen a month.' : 'Only the admin can close or reopen a month.'}</p>
      <table className="table">
        <thead><tr><th>Month</th><th className="num">Entries</th><th className="num">Income</th><th className="num">Expenses</th><th className="num">Net</th><th>Status</th><th /></tr></thead>
        <tbody>
          {fy.months.map((m) => (
            <tr key={m}>
              <td>{monthLabel(m)}</td><td className="num">{totals[m].n}</td><td className="num up">{money(totals[m].inc, false)}</td><td className="num dn">{money(totals[m].exp, false)}</td>
              <td className="num"><b>{money(round2(totals[m].inc - totals[m].exp), false)}</b></td>
              <td>{isClosed(m) ? <span className="fpill ok">🔒 Closed</span> : <span className="fpill part">Open</span>}</td>
              <td>{admin && <button className="btn ghost small" onClick={() => toggle(m)}>{isClosed(m) ? 'Reopen' : 'Close month'}</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {err && <p className="error">{err}</p>}
    </section>
  );
}
