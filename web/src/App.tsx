import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './lib/api';
import { Home } from './pages/Home';
import { Activities } from './pages/Activities';
import { ActivityDetail } from './pages/ActivityDetail';
import { Inbox } from './pages/Inbox';
import { MountainPage } from './pages/MountainPage';
import { Import } from './pages/Import';
import { Settings } from './pages/Settings';

/** タブのアイコン。線だけの図形にして、色は currentColor に任せる */
const ICON = {
  home: 'M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  activities: 'M3 18l5.5-8 3.5 4.5L15 11l6 7z M7.5 7.5h.01',
  inbox: 'M3 13h4l2 3h6l2-3h4 M3 13l2.5-7h13L21 13v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
  import: 'M12 15V4 M8.5 7.5 12 4l3.5 3.5 M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
  settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 0 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 0 1 0-4 1.7 1.7 0 0 0 1.4-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4a2 2 0 0 1 4 0 1.7 1.7 0 0 0 2.9 1.4l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 0 1 0 4z',
} as const;

const NAV = [
  { to: '/', label: 'ホーム', end: true, icon: ICON.home },
  { to: '/activities', label: '山行', icon: ICON.activities },
  { to: '/inbox', label: '未分類', icon: ICON.inbox },
  { to: '/import', label: '取り込み', icon: ICON.import },
  { to: '/settings', label: '設定', icon: ICON.settings },
];

export function App() {
  const [unassigned, setUnassigned] = useState(0);
  const location = useLocation();

  // 画面を移るたびに数え直す。起動時の1回だけだと、削除や割り当ての後も古い数字が残る
  useEffect(() => {
    api
      .progress()
      .then((p) => setUnassigned(p.unassigned_photo_count))
      .catch(() => setUnassigned(0));
  }, [location.pathname]);

  return (
    <>
      {/* 上は名前だけ。移動は親指の届く下のタブバーで行う */}
      <nav className="global-nav">
        <span className="brand">YamaLog</span>
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

      <nav className="tab-bar">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => (isActive ? 'active' : '')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={item.icon} />
            </svg>
            {item.label}
            {item.to === '/inbox' && unassigned > 0 && <span className="nav-badge">{unassigned}</span>}
          </NavLink>
        ))}
      </nav>

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
