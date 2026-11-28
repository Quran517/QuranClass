import { useState } from 'react';
import { supabase } from './supabase.js';
import { useQuery } from './data.js';
import { formatDate, whatsappLink } from './util.js';
import { downloadPdf } from './exports.js';
import { getSettings } from './settings.js';
import { money, cur, statement, statusOf, STATUS_TEXT, isMissing } from './finance.js';

// Fee statement of one or more students (brothers and sisters together).
export async function loadStatements(ids) {
  if (!ids.length) return { data: [], error: null };
  const [c, p] = await Promise.all([
    supabase.from('fee_charges').select('*, fee_plans(name)').in('student_id', ids).order('period_start'),
    supabase.from('fin_entries').select('id, entry_no, entry_date, amount, method, details, status, student_id, kind').eq('kind', 'income').in('student_id', ids).order('entry_date'),
  ]);
  if (c.error || p.error) return { data: null, error: c.error || p.error };
  return { data: ids.map((id) => ({ id, ...statement(c.data.filter((x) => x.student_id === id), p.data.filter((x) => x.student_id === id)) })), error: null };
}

export async function statementPdf(students, stmts, title) {
  const st = getSettings();
  const tables = [];
  stmts.forEach((s, i) => {
    const stu = students.find((x) => x.id === s.id) || {};
    tables.push({
      newPage: i > 0, section: `${stu.full_name || ''}  (${stu.student_code || ''})`,
      sectionNote: `Charged ${money(s.charged)}   ·   Paid ${money(s.paid)}   ·   Balance ${money(s.balance)}${s.credit > 0 ? `   ·   Advance ${money(s.credit)}` : ''}`,
      heading: 'Statement', columns: ['Date', 'Details', 'Reference', `Fee (${cur()})`, `Paid (${cur()})`, `Balance (${cur()})`],
      rows: s.lines.map((l) => [formatDate(l.date), l.text + (l.note ? ` — ${l.note}` : ''), l.ref || '', l.debit ? money(l.debit, false) : '', l.credit ? money(l.credit, false) : '', money(l.balance, false)]),
      compact: true,
    });
  });
  const tot = stmts.reduce((n, s) => n + s.balance, 0);
  await downloadPdf(`fee-statement-${(students[0]?.student_code || 'student')}${students.length > 1 ? '-family' : ''}.pdf`, {
    title: title || `Fee statement — ${students.map((s) => s.full_name).join(', ')}`,
    subtitle: `${st.school_name}   ·   ${formatDate(new Date().toISOString().slice(0, 10))}${students.length > 1 ? `   ·   Family balance ${money(tot)}` : ''}`,
    orientation: 'portrait', tables,
  });
}

export default function FeeStatement({ students, phone, guardian, compact = false }) {
  const ids = students.map((s) => s.id);
  const q = useQuery(() => loadStatements(ids), [ids.join(',')]);
  const [busy, setBusy] = useState(false);
  if (q.loading) return <div className="spinner" />;
  if (q.error) return <p className={isMissing(q.error) ? 'small muted' : 'error'}>{isMissing(q.error) ? 'Fee statements are not set up yet.' : q.error}</p>;
  const stmts = q.data || [];
  const total = stmts.reduce((n, s) => n + s.balance, 0);
  const text = `Assalamu Alaikum ${guardian || 'Parent'},\n\nFee statement — ${getSettings().school_name}\n` +
    stmts.map((s) => { const stu = students.find((x) => x.id === s.id); return `• ${stu?.full_name} (${stu?.student_code}): charged ${money(s.charged)}, paid ${money(s.paid)}, balance ${money(s.balance)}`; }).join('\n') +
    (stmts.length > 1 ? `\nFamily balance: ${money(total)}` : '') + '\n\nJazakAllahu khairan.';
  return (
    <div className="fee-statement">
      {stmts.map((s) => {
        const stu = students.find((x) => x.id === s.id) || {};
        const status = statusOf(s);
        return (
          <div key={s.id} className="stmt-block">
            {students.length > 1 || !compact ? <h4>{stu.full_name} <span className="muted small">{stu.student_code}</span> <span className={`fpill ${status === 'paid' ? 'ok' : status === 'part' ? 'part' : status === 'unpaid' ? 'no' : ''}`}>{STATUS_TEXT[status]}</span></h4> : null}
            <div className="stmt-sum">
              <div><small>Fees charged</small><b>{money(s.charged)}</b></div>
              <div><small>Paid</small><b className="up">{money(s.paid)}</b></div>
              <div><small>{s.balance < 0 ? 'Paid in advance' : 'Balance to pay'}</small><b className={s.balance > 0 ? 'dn' : 'up'}>{money(Math.abs(s.balance))}</b></div>
            </div>
            {s.lines.length === 0 ? <p className="small muted">No fees yet.</p> : (
              <div className="table-wrap">
                <table className="table small-table">
                  <thead><tr><th>Date</th><th>Details</th><th className="num">Fee</th><th className="num">Paid</th><th className="num">Balance</th></tr></thead>
                  <tbody>
                    {s.lines.map((l) => (
                      <tr key={l.kind + l.id}>
                        <td className="nowrap">{formatDate(l.date)}</td>
                        <td>{l.text}{l.note ? <div className="small muted">{l.note}</div> : null}</td>
                        <td className="num">{l.debit ? money(l.debit, false) : ''}</td>
                        <td className="num up">{l.credit ? money(l.credit, false) : ''}</td>
                        <td className="num"><b>{money(l.balance, false)}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
      {stmts.length > 1 && <p><b>Family balance: <span className={total > 0 ? 'dn' : 'up'}>{money(total)}</span></b></p>}
      <div className="actions">
        <button className="btn ghost small" disabled={busy} onClick={async () => { setBusy(true); await statementPdf(students, stmts); setBusy(false); }}>⬇ Statement PDF</button>
        {phone && whatsappLink(phone, 'x') && <a className="btn whatsapp small" target="_blank" rel="noreferrer" href={whatsappLink(phone, text)}>WhatsApp statement</a>}
      </div>
    </div>
  );
}
