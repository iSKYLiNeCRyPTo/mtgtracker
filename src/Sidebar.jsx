import React from "react";

const TEAL   = "#00D4AA";
const BORDER = "#1e1e1e";

const Icons = {
  Home: ({ size=20, color="#fff" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M3 10.5L12 3l9 7.5V21a1 1 0 01-1 1H5a1 1 0 01-1-1V10.5z" stroke={color} strokeWidth="1.8" strokeLinejoin="round"/>
      <path d="M9 22V12h6v10" stroke={color} strokeWidth="1.8" strokeLinejoin="round"/>
    </svg>
  ),
  Search: ({ size=20, color="#fff" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="10.5" cy="10.5" r="6.5" stroke={color} strokeWidth="1.8"/>
      <path d="M15.5 15.5L21 21" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  ),
  Camera: ({ size=20, color="#fff" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="2" y="6" width="20" height="15" rx="2.5" stroke={color} strokeWidth="1.8"/>
      <circle cx="12" cy="13.5" r="4" stroke={color} strokeWidth="1.8"/>
      <path d="M8.5 6l1.5-3h4l1.5 3" stroke={color} strokeWidth="1.8" strokeLinejoin="round"/>
    </svg>
  ),
  Pack: ({ size=20, color="#fff" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3" y="8" width="18" height="13" rx="2" stroke={color} strokeWidth="1.8"/>
      <path d="M3 11h18" stroke={color} strokeWidth="1.8"/>
      <path d="M8 8V6a4 4 0 018 0v2" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  ),
  Portfolio: ({ size=20, color="#fff" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="2" y="7" width="20" height="15" rx="2" stroke={color} strokeWidth="1.8"/>
      <path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2" stroke={color} strokeWidth="1.8" strokeLinejoin="round"/>
      <path d="M2 13h20" stroke={color} strokeWidth="1.8"/>
    </svg>
  ),
  Deck: ({ size=20, color="#fff" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="1"   y="5" width="13" height="17" rx="2" stroke={color} strokeWidth="1.6" opacity="0.28"/>
      <rect x="4.5" y="3" width="13" height="17" rx="2" stroke={color} strokeWidth="1.6" opacity="0.58"/>
      <rect x="8"   y="1" width="13" height="17" rx="2" stroke={color} strokeWidth="1.8"/>
      <path d="M10.5 5.5h8" stroke={color} strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  ),
};

const fmt = (n) => {
  if (!n || isNaN(n)) return "$0";
  if (n >= 1000) return "$" + (n/1000).toFixed(1) + "k";
  return new Intl.NumberFormat("en-US", { style:"currency", currency:"USD", minimumFractionDigits:2 }).format(n);
};

export default function DesktopSidebar({ tab, setTab, setScanning, collection, onSync, onNavigate }) {
  const navItems = [
    { id:"home",       label:"Home",      Icon:Icons.Home },
    { id:"search",     label:"Search",    Icon:Icons.Search },
    { id:"packs",      label:"Packs",     Icon:Icons.Pack },
    { id:"decks", label:"Decks", Icon:Icons.Deck },
  ];

  // Sum collection value using Scryfall prices (usd / usd_foil based on foil flag)
  const totalValue = (collection || []).reduce((s, i) => {
    const p = i.card?.prices || {};
    const price = parseFloat((i.foil ? p.usd_foil : p.usd) || p.usd || p.usd_foil || 0);
    return s + price;
  }, 0);

  return (
    <div className="sidebar">
      <div style={{ padding:"0 20px 24px", borderBottom:"1px solid #1e1e1e", marginBottom:8 }}>
        <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:24, color:TEAL, letterSpacing:2 }}>MTGTRACKER</div>
        <div style={{ color:"#444", fontSize:11, marginTop:2 }}>Card Investment Tracker</div>
      </div>

      {navItems.map(item => {
        const active = tab === item.id;
        const NavIcon = item.Icon;
        const borderStyle = active ? ("3px solid " + TEAL) : "3px solid transparent";
        return (
          <button key={item.id} onClick={() => onNavigate ? onNavigate(item.id) : setTab(item.id)} style={{
            display:"flex", alignItems:"center", gap:12, padding:"12px 20px",
            background: active ? "#151515" : "none",
            border:"none", cursor:"pointer", width:"100%",
            borderLeft: borderStyle, transition:"all 0.15s",
          }}>
            <NavIcon size={20} color={active ? TEAL : "#555"}/>
            <span style={{ color: active ? TEAL : "#555", fontSize:13, fontWeight: active ? 700 : 400 }}>{item.label}</span>
          </button>
        );
      })}

      <button onClick={() => setScanning(true)} style={{
        display:"flex", alignItems:"center", gap:12, padding:"12px 20px",
        background:"none", border:"none", cursor:"pointer", width:"100%",
        borderLeft:"3px solid transparent", margin:"4px 0",
      }}>
        <div style={{ width:32, height:32, borderRadius:"50%", background:TEAL,
          display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
          <Icons.Camera size={16} color="#000"/>
        </div>
        <span style={{ color:TEAL, fontSize:13, fontWeight:700 }}>Scan Card</span>
      </button>

      <div style={{ marginTop:"auto", padding:"20px", borderTop:"1px solid #1e1e1e" }}>
        <div style={{ color:"#444", fontSize:10, letterSpacing:0.5, marginBottom:6 }}>TOTAL VALUE</div>
        <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, color:TEAL, letterSpacing:1 }}>
          {fmt(totalValue)}
        </div>
        <div style={{ color:"#444", fontSize:11, marginTop:4 }}>{(collection||[]).length} cards</div>
      </div>

      <button onClick={onSync} style={{
        display:"flex", alignItems:"center", gap:8, padding:"10px 20px",
        background:"none", border:"none", cursor:"pointer", width:"100%",
        borderLeft:"3px solid transparent", color:"#555", marginTop:4,
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M4 4v5h5M20 20v-5h-5" stroke="#555" strokeWidth="1.8" strokeLinecap="round"/>
          <path d="M20 9a8 8 0 00-14.93-2M4 15a8 8 0 0014.93 2" stroke="#555" strokeWidth="1.8" strokeLinecap="round"/>
        </svg>
        <span style={{ fontSize:12 }}>Sync Devices</span>
      </button>
    </div>
  );
}

export function SyncButton({ onClick }) {
  return (
    <button onClick={onClick} style={{
      display:"flex", alignItems:"center", gap:8, padding:"10px 20px",
      background:"none", border:"none", cursor:"pointer", width:"100%",
      borderLeft:"3px solid transparent", color:"#555",
    }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path d="M8 17l-4-4 4-4M16 7l4 4-4 4" stroke="#555" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M4 13h16" stroke="#555" strokeWidth="1.8" strokeLinecap="round"/>
      </svg>
      <span style={{ fontSize:13 }}>Sync Devices</span>
    </button>
  );
}
