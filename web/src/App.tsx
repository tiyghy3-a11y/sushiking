import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { api } from './lib/api';
import { Home } from './pages/Home';
import { Activities } from './pages/Activities';
import { ActivityDetail } from './pages/ActivityDetail';
import { Inbox } from './pages/Inbox';
import { MountainPage } from './pages/MountainPage';
import { Import } from './pages/Import';
import { Settings } from './pages/Settings';

const NAV = [
  { to: '/', label: 'ホーム', end: true },
  { to: '/activities', label: '山行' },
  { to: '/inbox', label: '未分類' },
  { to: '/import', label: '取り込み' },
  { to: '/settings', label: '設定' },
];

export function App() {
  const [unassigned, setUnassigned] = useState(0);

  useEffect(() => {
    api
      .progress()
      .then((p) => setUnassigned(p.unassigned_photo_count))
      .catch(() => setUnassigned(0));
  }, []);

  return (
    <>
      {/* クロームには影を付けない。区切りは面の色で作る */}
      <nav className="global-nav">
        <span className="brand">YamaLog</span>
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => (isActive ? 'active' : '')}
          >
            {item.label}
            {item.to === '/inbox' && unassigned > 0 && <span className="nav-badge">{unassigned}</span>}
          </NavLink>
        ))}
        <span className="spacer" />
      </nav>

      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/activities" element={<Activities />} />
          <Route path="/activities/:id" element={<ActivityDetail />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/mountains/:id" element={<MountainPage />} />
          <Route path="/import" element={<Import />} />
          <Route path="/settings" element={<Settings />} />
          <Route
            path="*"
            element={
              <section className="section canvas-light">
                <div className="wrap-narrow">
                  <h1 className="t-display">ページが見つかりません</h1>
                </div>
              </section>
            }
          />
        </Routes>
      </main>

      <footer className="footer">
        <div className="wrap">
          <p className="t-caption-strong">YamaLog</p>
          <p className="t-caption">
            写真のEXIFから山行を復元する個人用アーカイブ。統計値は写真のGPS情報から算出した推定値です。
          </p>
          <p className="legal" style={{ marginTop: 'var(--space-md)' }}>
            地図・写真タイル: 国土地理院
          </p>
        </div>
      </footer>
    </>
  );
}
