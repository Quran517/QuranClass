import { useSettings, logoOf } from './settings.js';
import { nextClassDay, today, classDaysLabel } from './util.js';

export const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

export function nextClassLabel(days) {
  const next = nextClassDay(days);
  return next === today() ? 'Today' : new Date(next + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
}

// Banner used at the top of every home page (admin, Principal, teacher, student, parent).
export function HomeHero({ name, title, subtitle, chips = [], actions, photo }) {
  const settings = useSettings();
  return (
    <section className="dash-hero">
      {photo ? <img className="dash-hero-logo photo" src={photo} alt="" /> : <img className="dash-hero-logo" src={logoOf(settings)} alt="" />}
      <div className="dash-hero-text">
        <p className="dash-hello">{greet()}{name ? `, ${name}` : ''} · Assalamu Alaikum</p>
        <h2>{title || settings.school_name}</h2>
        <p className="dash-sub">{subtitle ?? `${settings.academic_year} · Class every ${classDaysLabel(settings.class_days)}`}</p>
        <div className="dash-chips">
          <span className="chip-light">📅 Next class: <b>{nextClassLabel(settings.class_days)}</b></span>
          {chips.map((c, i) => <span key={i} className="chip-light">{c}</span>)}
        </div>
      </div>
      {actions && <div className="dash-quick">{actions}</div>}
    </section>
  );
}

export function Tile({ icon, value, label, sub, tone = 'navy', onClick, attention }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={`kpi ${tone} ${attention ? 'attention' : ''} ${onClick ? '' : 'static'}`} onClick={onClick}>
      <span className="kpi-icon" aria-hidden="true">{icon}</span>
      <span className="kpi-text"><b>{value}</b><span>{label}</span>{sub && <small>{sub}</small>}</span>
    </Tag>
  );
}
