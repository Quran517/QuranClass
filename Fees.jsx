import { needsSql } from './finance.js';
import { useMemo, useState } from 'react';
import { supabase } from './supabase.js';
import { useQuery, fetchAllRows, fetchGroups } from './data.js';
import { formatDate, today, whatsappLink, classTag } from './util.js';
import { downloadExcel, downloadPdf } from './exports.js';
import { useSettings, loadSettings } from './settings.js';
import Modal from './Modal.jsx';
import FeeStatement from './FeeStatement.jsx';
import {
  money, cur, round2, monthStart, monthLabel, addMonths, statement, statusOf, STATUS_TEXT, ageBucket,
  fetchMethods, isMissing, NEEDS_SQL, receiptPdf, receiptText,
} from './finance.js';

const FREQ = { monthly: 'Every month', term: 'Every term', yearly: 'Once a year', once: 'One time (e.g. admission)' };
const phoneKey = (p) => String(p || '').replace(/\D/g, '').slice(-9);

// Shared data for fees: students, classes, family links, charges and payments.
export function useFeeData() {
  return useQuery(async () => {
    try {
      const [students, classes, links, charges, pays] = await Promise.all([
        fetchAllRows(() => supabase.from('students').select('id, full_name, student_code, admission_no, class_id, guardian_name, guardian_phone, whatsapp, date_of_birth, status, profile_id').eq('status', 'approved').order('full_name')),
        supabase.from('classes').select('id, name, group_id, teacher_id').order('name').then((r) => r.data || []),
        supabase.from('parent_links').select('parent_id, student_id').then((r) => r.data || []),
        fetchAllRows(() => supabase.from('fee_charges').select('*, fee_plans(name)').order('period_start')),
        fetchAllRows(() => supabase.from('fin_entries').select('id, entry_no, entry_date, amount, method, details, status, student_id, party, reference').eq('kind', 'income').not('student_id', 'is', null).order('entry_date')),
      ]);
      const famOf = {};
      for (const s of students) {
        const link = links.filter((l) => l.student_id === s.id).map((l) => l.parent_id).sort()[0];
        famOf[s.id] = link ? 'p:' + link : phoneKey(s.guardian_phone || s.whatsapp) ? 't:' + phoneKey(s.guardian_phone || s.whatsapp) : 's:' + s.id;
      }
      const rows = students.map((s) => {
        const st = statement(charges.filter((c) => c.student_id === s.id), pays.filter((p) => p.student_id === s.id));
        return { ...s, klass: classes.find((c) => c.id === s.class_id), fam: famOf[s.id], st, status: statusOf(st), age: ageBucket(st.open) };
      });
      return { data: { rows, classes, charges, pays }, error: null };
    } catch (e) { return { data: null, error: e }; }
  });
}

export default function Fees({ profile }) {
  const [view, setView] = useState('collect');
  const data = useFeeData();
  const methods = useQuery(fetchMethods);
  const plans = useQuery(() => supabase.from('fee_plans').select('*').order('created_at'));
  const groups = useQuery(fetchGroups);
  if (data.error || plans.error) return <section className="card"><h2>Fees & collection</h2><p className="error">{isMissing(data.error || plans.error) ? needsSql(data.error || plans.error) : String(data.error?.message || data.error || plans.error)}</p></section>;
  return (
    <>
      <section className="card">
        <h2>Fees & collection</h2>
        <p className="small muted">Set the fees, create them each month or term, record payments and send receipts. Brothers and sisters are found by their parent login or the same guardian phone.</p>
        <div className="seg-tabs">
          {[['collect', 'Collection'], ['create', 'Create fees'], ['plans', 'Fee plans'], ['discounts', 'Discounts & free places']].map(([k, l]) => (
            <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>
          ))}
        </div>
      </section>
      {!data.data || !plans.data ? <div className="spinner" /> : view === 'collect' ? (
        <Collection data={data.data} methods={methods.data || []} reload={data.reload} />
      ) : view === 'create' ? (
        <CreateFees plans={plans.data || []} data={data.data} reload={data.reload} groups={groups.data || []} />
      ) : view === 'plans' ? (
        <Plans plans={plans} classes={data.data.classes} groups={groups.data || []} />
      ) : (
        <Discounts rows={data.data.rows} />
      )}
    </>
  );
}

// ---------- Collection ----------
function Collection({ data, methods, reload }) {
  const [classId, setClassId] = useState('all');
  const [status, setStatus] = useState('owe');
  const [q, setQ] = useState('');
  const [byFamily, setByFamily] = useState(false);
  const [pay, setPay] = useState(null);
  const [stmt, setStmt] = useState(null);
  const rows = data.rows.filter((r) => (classId === 'all' || r.class_id === classId)
    && (status === 'all' || (status === 'owe' ? r.st.balance > 0 : r.status === status))
    && (!q || `${r.full_name} ${r.student_code} ${r.admission_no || ''} ${r.guardian_name || ''} ${r.guardian_phone || ''}`.toLowerCase().includes(q.toLowerCase())));
  const tot = (k) => round2(data.rows.reduce((n, r) => n + r.st[k], 0));
  const family = (r) => data.rows.filter((x) => x.fam === r.fam);
  const fams = useMemo(() => {
    const m = new Map();
    for (const r of rows) { if (!m.has(r.fam)) m.set(r.fam, []); m.get(r.fam).push(r); }
    return [...m.values()];
  }, [rows]);
  const xrows = () => rows.map((r) => ({
    'Student ID': r.student_code, 'Adm No': r.admission_no || '', Name: r.full_name, Class: r.klass ? classTag(r.klass) : '', Guardian: r.guardian_name || '', Phone: r.guardian_phone || r.whatsapp || '',
    Charged: r.st.charged, Paid: r.st.paid, Balance: r.st.balance, Status: STATUS_TEXT[r.status], 'Oldest unpaid': r.age,
  }));

  return (
    <>
      <div className="fin-kpis">
        <div className="fin-kpi inc"><small>Fees charged (all time)</small><b>{money(tot('charged'))}</b><i className="muted">{data.rows.length} students</i></div>
        <div className="fin-kpi bal"><small>Collected</small><b className="up">{money(tot('paid'))}</b><i className="muted">{tot('charged') ? Math.round((tot('paid') / tot('charged')) * 100) : 0}% of fees</i></div>
        <div className="fin-kpi due"><small>Still to collect</small><b className="dn">{money(round2(data.rows.reduce((n, r) => n + Math.max(0, r.st.balance), 0)))}</b><i className="dn">{data.rows.filter((r) => r.st.balance > 0).length} students owe</i></div>
        <div className="fin-kpi exp"><small>Paid in advance</small><b>{money(round2(data.rows.reduce((n, r) => n + Math.max(0, -r.st.balance), 0)))}</b><i className="muted">{data.rows.filter((r) => r.st.balance < 0).length} students</i></div>
      </div>
      <section className="card">
        <div className="filters">
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="owe">Students who owe</option><option value="all">All students</option><option value="unpaid">Not paid</option><option value="part">Part paid</option><option value="paid">Paid</option><option value="none">No fees yet</option>
          </select>
          <select value={classId} onChange={(e) => setClassId(e.target.value)} aria-label="Class"><option value="all">All classes</option>{data.classes.map((c) => <option key={c.id} value={c.id}>{classTag(c)}</option>)}</select>
          <input type="search" placeholder="Search student, ID, guardian, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="inline small"><input type="checkbox" checked={byFamily} onChange={(e) => setByFamily(e.target.checked)} /> Group brothers & sisters</label>
          <button className="btn ghost small" onClick={() => downloadExcel('fee-collection.xlsx', [{ name: 'Collection', rows: xrows() }], { title: 'Fee collection', subtitle: `${rows.length} students` })}>Excel</button>
          <button className="btn ghost small" onClick={() => downloadPdf('fee-collection.pdf', { title: 'Fee collection', subtitle: `${rows.length} students   ·   Still to collect ${money(round2(rows.reduce((n, r) => n + Math.max(0, r.st.balance), 0)))}`, tables: [{ heading: 'Students', columns: Object.keys(xrows()[0] || { Name: '' }), rows: xrows().map((r) => Object.values(r).map((v) => (typeof v === 'number' ? money(v, false) : v))), compact: true }] })}>PDF</button>
        </div>
        {!rows.length ? <p className="muted">No students match.</p> : (
          <div className="table-wrap">
            <table className="table fin-table">
              <thead><tr><th>Student</th><th>Class</th><th>Guardian</th><th className="num">Charged</th><th className="num">Paid</th><th className="num">Balance</th><th>Status</th><th /></tr></thead>
              <tbody>
                {(byFamily ? fams : rows.map((r) => [r])).map((grp) => grp.map((r, i) => (
                  <tr key={r.id} className={byFamily && i === 0 && grp.length > 1 ? 'fam-first' : ''}>
                    <td><b>{r.full_name}</b> <span className="small muted">{r.student_code}{r.admission_no ? ` · ${r.admission_no}` : ''}</span>{byFamily && grp.length > 1 && i === 0 && <div className="small muted">👪 {grp.length} children</div>}</td>
                    <td className="small">{r.klass?.name || '—'}</td>
                    <td className="small">{r.guardian_name}<div className="muted">{r.guardian_phone || r.whatsapp}</div></td>
                    <td className="num">{money(r.st.charged, false)}</td>
                    <td className="num up">{money(r.st.paid, false)}</td>
                    <td className={`num ${r.st.balance > 0 ? 'dn' : ''}`}><b>{money(r.st.balance, false)}</b>{r.age && r.age !== 'Current' ? <div className="small dn">{r.age}</div> : null}</td>
                    <td><span className={`fpill ${r.status === 'paid' ? 'ok' : r.status === 'part' ? 'part' : r.status === 'unpaid' ? 'no' : ''}`}>{STATUS_TEXT[r.status]}</span></td>
                    <td className="nowrap">
                      <button className="btn small" onClick={() => setPay(r)}>Receive payment</button>{' '}
                      <button className="btn ghost small" onClick={() => setStmt(r)}>Statement</button>
                    </td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {pay && <PaymentForm student={pay} family={family(pay)} methods={methods} onClose={() => setPay(null)} onSaved={() => { reload(); }} />}
      {stmt && (
        <Modal title={`Fee statement — ${stmt.full_name}`} onClose={() => setStmt(null)}>
          <FeeStatement students={family(stmt).length > 1 ? family(stmt) : [stmt]} phone={stmt.whatsapp || stmt.guardian_phone} guardian={stmt.guardian_name} />
        </Modal>
      )}
    </>
  );
}

// Record a payment for one child or the whole family; the money pays the oldest fees first.
function PaymentForm({ student, family, methods, onClose, onSaved }) {
  const [who, setWho] = useState(family.length > 1 ? 'family' : 'one');
  const kids = who === 'family' ? family : [student];
  const due = round2(kids.reduce((n, k) => n + Math.max(0, k.st.balance), 0));
  const [f, setF] = useState({ amount: String(due || ''), date: today(), method: methods.find((m) => m.active)?.name || 'Cash', party: student.guardian_name || '', reference: '', details: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  // split the amount: oldest unpaid fee of any child first; any extra goes to the first child as advance
  const split = () => {
    let left = round2(f.amount);
    const open = kids.flatMap((k) => k.st.open.map((o) => ({ k, o }))).sort((a, b) => (a.o.date < b.o.date ? -1 : 1));
    const share = new Map(kids.map((k) => [k.id, { amt: 0, periods: [] }]));
    for (const { k, o } of open) { if (left <= 0) break; const t = Math.min(left, o.owe); left = round2(left - t); const s = share.get(k.id); s.amt = round2(s.amt + t); s.periods.push(o.ref); }
    if (left > 0) { const s = share.get(kids[0].id); s.amt = round2(s.amt + left); s.periods.push('advance'); }
    return kids.map((k) => ({ k, ...share.get(k.id) })).filter((x) => x.amt > 0);
  };

  async function save(e) {
    e.preventDefault(); setErr('');
    const amt = round2(f.amount);
    if (!(amt > 0)) { setErr('Please enter the amount received.'); return; }
    setBusy(true);
    const { data: cat } = await supabase.from('fin_categories').select('id').eq('kind', 'income').eq('name', 'Student fees').maybeSingle();
    const parts = split();
    const ref = f.reference.trim() || (parts.length > 1 ? `Family payment ${formatDate(f.date)}` : null);
    const { data, error } = await supabase.from('fin_entries').insert(parts.map((p) => ({
      kind: 'income', entry_date: f.date, category_id: cat?.id || null, amount: p.amt, method: f.method, party: f.party.trim() || null, reference: ref,
      details: f.details.trim() || `Fees — ${p.periods.join(', ')}`, student_id: p.k.id,
    }))).select('id, entry_no, entry_date, amount, method, party, reference, details, student_id');
    setBusy(false);
    if (error) { setErr(isMissing(error) ? needsSql(error) : error.message); return; }
    const list = data.map((d) => ({ ...d, student_label: `${kids.find((k) => k.id === d.student_id)?.full_name} (${kids.find((k) => k.id === d.student_id)?.student_code})` }));
    setDone({ list, balanceAfter: round2(due - amt) });
    onSaved();
  }

  if (done) {
    const names = kids.filter((k) => done.list.some((d) => d.student_id === k.id)).map((k) => k.full_name).join(', ');
    const phone = student.whatsapp || student.guardian_phone;
    return (
      <Modal title="Payment saved" onClose={onClose}>
        <p className="success">Received {money(done.list.reduce((n, d) => n + Number(d.amount), 0))} — receipt {done.list.map((d) => d.entry_no).join(', ')}.</p>
        {done.balanceAfter > 0 && <p>Balance still to pay: <b className="dn">{money(done.balanceAfter)}</b></p>}
        {done.balanceAfter < 0 && <p>Paid in advance: <b className="up">{money(-done.balanceAfter)}</b></p>}
        <div className="actions">
          <button className="btn" onClick={() => receiptPdf({ entries: done.list, studentNames: names, family: f.party, balanceAfter: Math.max(0, done.balanceAfter) })}>⬇ Receipt PDF</button>
          <button className="btn ghost" onClick={() => receiptPdf({ entries: done.list, studentNames: names, family: f.party, balanceAfter: Math.max(0, done.balanceAfter), print: true })}>🖨 Print receipt</button>
          {whatsappLink(phone, 'x') && <a className="btn whatsapp" target="_blank" rel="noreferrer" href={whatsappLink(phone, receiptText({ entries: done.list, family: f.party, studentNames: names, balanceAfter: Math.max(0, done.balanceAfter) }))}>WhatsApp receipt</a>}
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title={`Receive payment — ${student.full_name}`} onClose={onClose}>
      {family.length > 1 && (
        <div className="seg-tabs">
          <button className={who === 'one' ? 'on' : ''} onClick={() => setWho('one')}>Only {student.full_name.split(' ')[0]}</button>
          <button className={who === 'family' ? 'on' : ''} onClick={() => setWho('family')}>Whole family ({family.length} children)</button>
        </div>
      )}
      <table className="table small-table">
        <thead><tr><th>Student</th><th>Unpaid fees</th><th className="num">To pay</th></tr></thead>
        <tbody>
          {kids.map((k) => (
            <tr key={k.id}><td>{k.full_name} <span className="small muted">{k.student_code}</span></td><td className="small">{k.st.open.map((o) => `${o.ref} (${money(o.owe, false)})`).join(', ') || <span className="muted">nothing due</span>}</td><td className="num"><b>{money(Math.max(0, k.st.balance), false)}</b></td></tr>
          ))}
          <tr><td colSpan={2}><b>Total due</b></td><td className="num"><b className="dn">{money(due)}</b></td></tr>
        </tbody>
      </table>
      <form className="form-grid" onSubmit={save}>
        <label>Amount received ({cur()}) *<input type="number" min="0.01" step="0.01" required value={f.amount} onChange={set('amount')} autoFocus /></label>
        <label>Date<input type="date" value={f.date} onChange={set('date')} /></label>
        <label>Payment method<select value={f.method} onChange={set('method')}>{methods.filter((m) => m.active).map((m) => <option key={m.id}>{m.name}</option>)}</select></label>
        <label>Received from<input value={f.party} onChange={set('party')} /></label>
        <label>Reference<input value={f.reference} onChange={set('reference')} placeholder="Bank ref / STC Pay ref" /></label>
        <label>Details (optional)<input value={f.details} onChange={set('details')} placeholder="Filled in automatically" /></label>
        {round2(f.amount) > 0 && <p className="span2 small muted">This pays: {split().map((p) => `${p.k.full_name} ${money(p.amt)} (${p.periods.join(', ')})`).join(' · ')}</p>}
        {err && <p className="error span2">{err}</p>}
        <div className="span2 actions"><button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save payment'}</button><button type="button" className="btn ghost" onClick={onClose}>Cancel</button></div>
      </form>
    </Modal>
  );
}

// ---------- Create fees for a period ----------
function CreateFees({ plans, data, reload, groups }) {
  const active = plans.filter((p) => p.active);
  const [planId, setPlanId] = useState(active[0]?.id || '');
  const plan = plans.find((p) => p.id === planId);
  const [month, setMonth] = useState(monthStart());
  const [label, setLabel] = useState('');
  const [start, setStart] = useState(today());
  const [due, setDue] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const monthly = plan?.frequency === 'monthly';
  const pStart = monthly ? month : start;
  const pLabel = monthly ? monthLabel(month) : (label || (plan?.frequency === 'once' ? plan?.name : ''));
  const months = Array.from({ length: 15 }, (_, i) => addMonths(monthStart(), i - 9));

  async function run() {
    setErr(''); setMsg('');
    if (!plan) { setErr('Add a fee plan first (Fee plans tab).'); return; }
    if (!pLabel.trim()) { setErr('Please write a name for this period, e.g. "Term 1 2026".'); return; }
    setBusy(true);
    const { data: r, error } = await supabase.rpc('fin_generate_charges', { p_plan: plan.id, p_period_start: pStart, p_label: pLabel.trim(), p_due: due || null });
    setBusy(false);
    if (error) setErr(isMissing(error) ? needsSql(error) : error.message);
    else { setMsg(`${r.created} fee${r.created === 1 ? '' : 's'} created for ${pLabel}. ${r.students - r.created > 0 ? `${r.students - r.created} skipped (already created, or free place).` : ''}`); reload(); }
  }
  // batches already created
  const batches = useMemo(() => {
    const m = new Map();
    for (const c of data.charges.filter((x) => x.status === 'active')) {
      const k = c.plan_id + '|' + c.period_start;
      if (!m.has(k)) m.set(k, { plan: c.fee_plans?.name || 'Fee', label: c.period_label, start: c.period_start, plan_id: c.plan_id, n: 0, total: 0, disc: 0 });
      const b = m.get(k); b.n += 1; b.total = round2(b.total + c.amount - c.discount); b.disc = round2(b.disc + Number(c.discount));
    }
    return [...m.values()].sort((a, b) => (a.start < b.start ? 1 : -1));
  }, [data.charges]);
  async function cancelBatch(b) {
    const reason = window.prompt(`Cancel all ${b.n} fees "${b.plan} — ${b.label}"? Payments are kept. Write a reason:`);
    if (!reason) return;
    const { error } = await supabase.from('fee_charges').update({ status: 'cancelled', cancel_reason: reason }).eq('plan_id', b.plan_id).eq('period_start', b.start).eq('status', 'active');
    if (error) setErr(error.message); else reload();
  }
  const groupName = (id) => groups.find((g) => g.id === id)?.name;

  return (
    <>
      <section className="card">
        <h3>Create fees for a period</h3>
        <p className="small muted">Creates the fee for every enrolled student the plan applies to. Brother / sister discounts and free places are applied automatically. Running it twice for the same period does not charge twice.</p>
        {!active.length ? <p className="notice-inline">First add a fee plan in the <b>Fee plans</b> tab.</p> : (
          <div className="form-grid">
            <label>Fee plan<select value={planId} onChange={(e) => setPlanId(e.target.value)}>{active.map((p) => <option key={p.id} value={p.id}>{p.name} — {money(p.amount)} · {FREQ[p.frequency]}</option>)}</select></label>
            {monthly ? (
              <label>Month<select value={month} onChange={(e) => setMonth(e.target.value)}>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></label>
            ) : (
              <>
                <label>Period name<input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={plan?.frequency === 'term' ? 'Term 1 2026' : plan?.frequency === 'yearly' ? 'Year 2026–2027' : plan?.name} /></label>
                <label>Start date<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
              </>
            )}
            <label>Due date (optional)<input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
            <p className="span2 small">Applies to: <b>{plan?.class_id ? data.classes.find((c) => c.id === plan.class_id)?.name : plan?.group_id ? groupName(plan.group_id) || 'one group' : 'all enrolled students in a class'}</b></p>
            <div className="span2"><button className="btn" disabled={busy} onClick={run}>{busy ? 'Creating…' : `Create fees — ${pLabel || '…'}`}</button></div>
          </div>
        )}
        {msg && <p className="success">{msg}</p>}
        {err && <p className="error">{err}</p>}
      </section>
      <section className="card">
        <h3>Fees created</h3>
        {!batches.length ? <p className="small muted">None yet.</p> : (
          <table className="table">
            <thead><tr><th>Fee</th><th>Period</th><th className="num">Students</th><th className="num">Discounts</th><th className="num">Total to collect</th><th /></tr></thead>
            <tbody>{batches.map((b) => <tr key={b.plan_id + b.start}><td>{b.plan}</td><td>{b.label}</td><td className="num">{b.n}</td><td className="num">{money(b.disc, false)}</td><td className="num"><b>{money(b.total, false)}</b></td><td><button className="btn ghost small" onClick={() => cancelBatch(b)}>Cancel</button></td></tr>)}</tbody>
          </table>
        )}
      </section>
    </>
  );
}

// ---------- Fee plans ----------
function Plans({ plans, classes, groups }) {
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState('');
  async function save(e) {
    e.preventDefault(); setErr('');
    const v = { name: edit.name.trim(), amount: round2(edit.amount), frequency: edit.frequency, group_id: edit.group_id || null, class_id: edit.class_id || null, sibling_discount: !!edit.sibling_discount, active: edit.active !== false };
    if (!v.name) { setErr('Please give the plan a name.'); return; }
    const { error } = edit.id ? await supabase.from('fee_plans').update(v).eq('id', edit.id) : await supabase.from('fee_plans').insert(v);
    if (error) setErr(isMissing(error) ? needsSql(error) : error.message); else { setEdit(null); plans.reload(); }
  }
  return (
    <section className="card">
      <div className="row-between"><h3>Fee plans</h3><button className="btn" onClick={() => setEdit({ name: '', amount: '', frequency: 'monthly', sibling_discount: true, active: true })}>+ New fee plan</button></div>
      <p className="small muted">Make as many as you need — e.g. "Monthly fee" for everyone, a different amount for one group, a term fee, or a one-time admission fee.</p>
      {!(plans.data || []).length ? <p className="muted">No fee plans yet.</p> : (
        <table className="table">
          <thead><tr><th>Name</th><th className="num">Amount</th><th>How often</th><th>For</th><th>Sibling discount</th><th>Status</th><th /></tr></thead>
          <tbody>
            {plans.data.map((p) => (
              <tr key={p.id} className={p.active ? '' : 'cancelled'}>
                <td><b>{p.name}</b></td><td className="num">{money(p.amount)}</td><td>{FREQ[p.frequency]}</td>
                <td>{p.class_id ? classes.find((c) => c.id === p.class_id)?.name : p.group_id ? groups.find((g) => g.id === p.group_id)?.name || 'Group' : 'Everyone'}</td>
                <td>{p.sibling_discount ? 'Yes' : 'No'}</td><td>{p.active ? <span className="fpill ok">Active</span> : <span className="fpill">Off</span>}</td>
                <td><button className="btn ghost small" onClick={() => setEdit({ ...p })}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {edit && (
        <Modal title={edit.id ? 'Edit fee plan' : 'New fee plan'} onClose={() => setEdit(null)}>
          <form className="form-grid" onSubmit={save}>
            <label className="span2">Name *<input required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Monthly fee / Term fee / Admission fee" /></label>
            <label>Amount ({cur()}) *<input type="number" min="0" step="0.01" required value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value })} /></label>
            <label>How often<select value={edit.frequency} onChange={(e) => setEdit({ ...edit, frequency: e.target.value })}>{Object.entries(FREQ).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label>Group<select value={edit.group_id || ''} onChange={(e) => setEdit({ ...edit, group_id: e.target.value, class_id: '' })}><option value="">All groups</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
            <label>Class<select value={edit.class_id || ''} onChange={(e) => setEdit({ ...edit, class_id: e.target.value })}><option value="">All classes</option>{classes.filter((c) => !edit.group_id || c.group_id === edit.group_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label className="inline span2"><input type="checkbox" checked={!!edit.sibling_discount} onChange={(e) => setEdit({ ...edit, sibling_discount: e.target.checked })} /> Give the brother / sister discount on this fee</label>
            <label className="inline span2"><input type="checkbox" checked={edit.active !== false} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active</label>
            {err && <p className="error span2">{err}</p>}
            <div className="span2 actions"><button className="btn">Save plan</button><button type="button" className="btn ghost" onClick={() => setEdit(null)}>Cancel</button></div>
          </form>
        </Modal>
      )}
    </section>
  );
}

// ---------- Discounts & free places ----------
function Discounts({ rows }) {
  const settings = useSettings();
  const [s2, setS2] = useState(settings.fin_sibling2_pct ?? 0);
  const [s3, setS3] = useState(settings.fin_sibling3_pct ?? 0);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const own = useQuery(() => supabase.from('fee_student').select('*'));
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  async function saveSib() {
    setErr(''); setMsg('');
    const { error } = await supabase.rpc('fin_set_settings', { p_sibling2: Number(s2) || 0, p_sibling3: Number(s3) || 0, p_currency: null, p_year_start: null });
    if (error) setErr(isMissing(error) ? needsSql(error) : error.message); else { setMsg('Saved. New fees will use these discounts.'); loadSettings(); }
  }
  async function saveOwn(e) {
    e.preventDefault();
    const v = { student_id: edit.student_id, exempt: !!edit.exempt, discount_pct: Number(edit.discount_pct) || 0, fixed_amount: edit.fixed_amount === '' || edit.fixed_amount == null ? null : round2(edit.fixed_amount), note: edit.note || null };
    const { error } = await supabase.from('fee_student').upsert(v);
    if (error) setErr(error.message); else { setEdit(null); own.reload(); }
  }
  const ownOf = (id) => (own.data || []).find((x) => x.student_id === id);
  const special = rows.filter((r) => { const o = ownOf(r.id); return o && (o.exempt || o.discount_pct > 0 || o.fixed_amount != null); });
  const found = q ? rows.filter((r) => `${r.full_name} ${r.student_code} ${r.admission_no || ''}`.toLowerCase().includes(q.toLowerCase())).slice(0, 8) : [];
  return (
    <div className="fin-grid">
      <section className="card">
        <h3>Brothers & sisters</h3>
        <p className="small muted">The eldest child pays the full fee. Children are linked by their parent login, or by the same guardian phone number.</p>
        <div className="form-grid">
          <label>2nd child discount (%)<input type="number" min="0" max="100" value={s2} onChange={(e) => setS2(e.target.value)} /></label>
          <label>3rd child and more (%)<input type="number" min="0" max="100" value={s3} onChange={(e) => setS3(e.target.value)} /></label>
          <div className="span2"><button className="btn" onClick={saveSib}>Save sibling discounts</button></div>
        </div>
        {msg && <p className="success">{msg}</p>}{err && <p className="error">{err}</p>}
        <p className="small muted">Changes apply to fees created from now on. Fees already created keep their amount.</p>
      </section>
      <section className="card">
        <h3>Free places & own discounts</h3>
        <input type="search" placeholder="Find a student to give a discount…" value={q} onChange={(e) => setQ(e.target.value)} />
        {found.map((r) => <div key={r.id} className="pick-row"><span className="pick-name">{r.full_name} <span className="muted small">{r.student_code}</span></span><button className="btn ghost small" onClick={() => setEdit({ student_id: r.id, name: r.full_name, ...(ownOf(r.id) || {}) })}>Set discount</button></div>)}
        <h4>Students with a free place or own discount ({special.length})</h4>
        {!special.length ? <p className="small muted">None.</p> : (
          <table className="table small-table">
            <thead><tr><th>Student</th><th>Arrangement</th><th>Note</th><th /></tr></thead>
            <tbody>{special.map((r) => { const o = ownOf(r.id); return (
              <tr key={r.id}><td>{r.full_name} <span className="muted small">{r.student_code}</span></td>
                <td>{o.exempt ? <span className="fpill ok">Free place</span> : o.fixed_amount != null ? `Pays ${money(o.fixed_amount)}` : `${o.discount_pct}% off`}</td><td className="small">{o.note}</td>
                <td><button className="btn ghost small" onClick={() => setEdit({ name: r.full_name, ...o })}>Edit</button></td></tr>); })}</tbody>
          </table>
        )}
      </section>
      {edit && (
        <Modal title={`Discount — ${edit.name}`} onClose={() => setEdit(null)}>
          <form className="form-grid" onSubmit={saveOwn}>
            <label className="inline span2"><input type="checkbox" checked={!!edit.exempt} onChange={(e) => setEdit({ ...edit, exempt: e.target.checked })} /> <b>Free place</b> — no fees are created for this student</label>
            {!edit.exempt && <>
              <label>Own discount (%)<input type="number" min="0" max="100" value={edit.discount_pct ?? 0} onChange={(e) => setEdit({ ...edit, discount_pct: e.target.value })} /></label>
              <label>…or a fixed fee ({cur()})<input type="number" min="0" step="0.01" value={edit.fixed_amount ?? ''} onChange={(e) => setEdit({ ...edit, fixed_amount: e.target.value })} placeholder="leave empty for normal fee" /></label>
            </>}
            <label className="span2">Note<input value={edit.note || ''} onChange={(e) => setEdit({ ...edit, note: e.target.value })} placeholder="e.g. Approved by principal — orphan support" /></label>
            <div className="span2 actions"><button className="btn">Save</button><button type="button" className="btn ghost" onClick={() => setEdit(null)}>Cancel</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
