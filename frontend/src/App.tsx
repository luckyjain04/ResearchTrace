
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, Atom, Bell, BookOpen, BarChart3, Check, ChevronRight,
  Clock3, FileText, FlaskConical, GitFork, History, Home,
  Search, Settings, ShieldCheck, Sparkles, Target, X, RefreshCw,
  ExternalLink, Network, Info, ZoomIn, ZoomOut, Maximize2,
} from 'lucide-react'

type Paper = { doc_id?: string; title?: string; abstract?: string; similarity?: number; is_annotated_source?: boolean }
type Evidence = { paper_id: string; title: string; label: string; sentence: string; sentence_index: number; claim?: string; source?: string }
type Analysis = { verdict: string; message: string; evidence: Evidence[]; papers: Paper[]; exact_match: boolean }
type PubmedPaper = { pmid?: string; title?: string; abstract?: string; journal?: string; publication_date?: string; url?: string; retrieval_score?: number }
type Dashboard = { total_papers: number; annotated_claims: number; evidence_types: number; verdict_distribution: Record<string, number>; statistics_note: string }
type Recent = { claim: string; verdict: string; date: string }
type GraphNode = { id: string; label: string; kind: 'claim' | 'paper' | 'evidence' | 'topic'; details?: string; paper_id?: string; abstract?: string; url?: string; evidence_label?: string; sentence_index?: number }
type GraphEdge = { source: string; target: string }
type GraphData = { claim: string; graph_type: string; nodes: GraphNode[]; edges: GraphEdge[]; pubmed_count?: number; search_error?: string | null }
type EvidenceResponse = { total: number; limit: number; offset: number; items: Evidence[] }
type Analytics = {
  total_papers: number; annotated_claims: number; verdict_distribution: Record<string, number>;
  annotation_label_counts: Record<string, number>; total_annotated_sentence_references: number;
  top_evidence_papers: { paper_id: string; title: string; evidence_sentence_count: number }[]; note: string
}
type Point = { x: number; y: number }

const API = 'http://127.0.0.1:8000'
const suggestions = ['Regular physical exercise reduces the risk of type 2 diabetes.', 'Smoking has no association with lung cancer.', 'Vitamin C supplementation prevents the common cold.']
const topics = [
  ['Artificial Intelligence in Healthcare', '+24%', 'blue'], ['Climate Change Mitigation', '+18%', 'green'],
  ['Mental Health & Technology', '+15%', 'purple'], ['Nutrition & Longevity', '+12%', 'cyan'], ['Renewable Energy', '+10%', 'green'],
]

const pageStyle: React.CSSProperties = { padding: '28px 34px 48px', maxWidth: 1440, margin: '0 auto' }
const cardStyle: React.CSSProperties = { background: 'rgba(14, 25, 45, .82)', border: '1px solid rgba(123, 158, 205, .16)', borderRadius: 16, padding: 22, marginBottom: 18 }
const controlStyle: React.CSSProperties = { background: '#0b1629', color: '#eaf2ff', border: '1px solid rgba(132,164,210,.25)', borderRadius: 9, padding: '11px 13px', outline: 'none', minWidth: 0 }
const primaryButton: React.CSSProperties = { background: 'linear-gradient(110deg,#1678ed,#19b7d5)', color: 'white', border: 0, borderRadius: 9, padding: '11px 16px', cursor: 'pointer', fontWeight: 700 }

function verdictClass(verdict: string) {
  const v = (verdict || '').toLowerCase()
  if (v.includes('support')) return 'support'
  if (v.includes('refute') || v.includes('contradict')) return 'refute'
  if (v.includes('mixed')) return 'mixed'
  return 'insufficient'
}

function GlobeArt() {
  return <div className="globe-wrap" aria-hidden="true">
    <div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="orbit orbit-three"/>
    <div className="globe"><div className="globe-grid"/><div className="globe-shine"/></div>
    <div className="float-card card-lab"><FlaskConical size={19}/><span>Scientific Evidence<small>Verified research signals</small></span></div>
    <div className="float-card card-paper"><FileText size={20}/><span>Research paper<small>Evidence retrieved</small></span></div>
    <div className="float-card card-data"><Activity size={20}/><span>Knowledge graph</span></div>
    {Array.from({length:18},(_,i)=><i key={i} className="star" style={{left:`${(i*37)%96}%`,top:`${(i*23)%88}%`,animationDelay:`${i*.17}s`}}/>)}
  </div>
}

function Metric({icon,label,value,color,note}:{icon:React.ReactNode;label:string;value:string;color:string;note:string}) {
  return <div className="metric-card"><div className={`metric-icon ${color}`}>{icon}</div><div className="metric-copy"><span>{label}</span><b>{value}</b><small>{note}</small></div><div className={`metric-glow ${color}`}/></div>
}
function PanelTitle({icon,title,action,onAction}:{icon:React.ReactNode;title:string;action?:string;onAction?:()=>void}) {
  return <div className="panel-title"><span>{icon}</span><b>{title}</b>{action&&<button onClick={onAction}>{action} <ChevronRight size={14}/></button>}</div>
}
function Feature({icon,title,sub,onClick}:{icon:React.ReactNode;title:string;sub:string;onClick:()=>void}) {
  return <button className="feature-row" onClick={onClick}><span>{icon}</span><div><b>{title}</b><small>{sub}</small></div><ChevronRight size={18}/></button>
}

export default function App() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [claim, setClaim] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [pubmed, setPubmed] = useState<PubmedPaper[]>([])
  const [recent, setRecent] = useState<Recent[]>(() => {
    try { return JSON.parse(localStorage.getItem('researchtrace-recent') || '[]') } catch { return [] }
  })
  const [active, setActive] = useState('Dashboard')
  const [apiOnline, setApiOnline] = useState(false)

  useEffect(() => {
    fetch(`${API}/api/dashboard`).then(r => { if (!r.ok) throw new Error('API unavailable'); return r.json() })
      .then((data: Dashboard) => { setDashboard(data); setApiOnline(true) })
      .catch(() => setApiOnline(false))
  }, [])
  useEffect(() => { localStorage.setItem('researchtrace-recent', JSON.stringify(recent.slice(0, 5))) }, [recent])

  const distribution = useMemo(() => {
    const raw = dashboard?.verdict_distribution || {}
    const total = Object.values(raw).reduce((a,b)=>a+b,0) || 1
    return [
      { label:'Supports', value:raw['Supports']||0, color:'#10c7a0' },
      { label:'Refutes', value:raw['Refutes']||0, color:'#f04462' },
      { label:'Mixed', value:raw['Mixed evidence']||0, color:'#8055f6' },
      { label:'Insufficient', value:raw['Insufficient evidence']||0, color:'#f5a623' },
    ].map(x=>({...x, percent:Math.round(x.value/total*100)}))
  }, [dashboard])

  async function runAnalysis(value = claim) {
    const clean = value.trim()
    if (!clean) { setError('Enter a scientific claim to investigate.'); return }
    setClaim(clean); setError(''); setLoading(true); setAnalysis(null); setPubmed([]); setActive('Investigate a Claim')
    try {
      const response = await fetch(`${API}/api/analyze`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({claim:clean,local_count:10,pubmed_count:5,include_pubmed:true}) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Analysis failed.')
      setAnalysis(data.local)
      setPubmed(data.pubmed?.papers || [])
      setRecent(prev => [{claim:clean, verdict:data.local.verdict, date:new Date().toISOString()}, ...prev.filter(x=>x.claim!==clean)].slice(0,5))
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not connect to ResearchTrace API.') }
    finally { setLoading(false) }
  }

  function openPage(name: string) {
    setActive(name)
    setAnalysis(null)
    setError('')
  }

  const nav = [
    {name:'Dashboard',icon:Home}, {name:'Investigate a Claim',icon:Search}, {name:'Knowledge Graph',icon:GitFork},
    {name:'Evidence Library',icon:BookOpen}, {name:'Research Analytics',icon:BarChart3}, {name:'History',icon:History}, {name:'Settings',icon:Settings},
  ]

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Atom size={36}/></div><div><b>ResearchTrace</b><small>AI Research Intelligence</small></div></div>
      <nav>{nav.map(({name,icon:Icon})=><button key={name} className={`nav-item ${active===name?'active':''}`} onClick={()=>openPage(name)}><Icon size={20}/><span>{name}</span></button>)}</nav>
      <div className="sidebar-promo"><Sparkles size={19}/><b>Evidence. Not Opinions.</b><span>Explore. Verify. Trust.</span><div className="promo-wave"/></div>
      <div className="sidebar-foot"><span className={`status-dot ${apiOnline?'online':''}`}/>{apiOnline?'Research engine connected':'API not connected'}</div>
    </aside>

    <main className="main-area">
      <header className="topbar">
        <div className="global-search"><Search size={19}/><input placeholder="Search for a claim, topic or research area..." value={claim} onChange={e=>setClaim(e.target.value)} onKeyDown={e=>e.key==='Enter'&&runAnalysis()}/><kbd>Ctrl</kbd><kbd>K</kbd></div>
        <button className="icon-button" aria-label="Notifications"><Bell size={20}/><i/></button><div className="avatar">LJ</div>
      </header>

      {active==='Dashboard' && !analysis && <DashboardPage dashboard={dashboard} distribution={distribution} recent={recent} claim={claim} setClaim={setClaim} loading={loading} error={error} runAnalysis={runAnalysis} openPage={openPage}/>}
      {active==='Investigate a Claim' && (analysis ? <ResultsView claim={claim} analysis={analysis} pubmed={pubmed} onBack={()=>{setAnalysis(null);setActive('Dashboard')}}/> : <section style={pageStyle}><PageHeading eyebrow="RESEARCH INVESTIGATION" title="Investigate a claim" subtitle="Submit a scientific statement to retrieve annotated SciFact evidence and related PubMed literature."/><form className="claim-search" onSubmit={e=>{e.preventDefault();runAnalysis()}}><Search size={21}/><input value={claim} onChange={e=>setClaim(e.target.value)} placeholder="Enter a research claim..."/><button disabled={loading}>{loading?'Analyzing':'Analyze'} <ChevronRight size={19}/></button></form>{error&&<p className="error-line"><X size={14}/>{error}</p>}<div style={{marginTop:22}}><b style={{color:'#a9c7ed'}}>Suggested claims</b><div style={{display:'grid',gap:10,marginTop:12}}>{suggestions.map(s=><button key={s} className="feature-row" onClick={()=>{setClaim(s);runAnalysis(s)}}>{s}<ChevronRight size={18}/></button>)}</div></div></section>)}
      {active==='Knowledge Graph' && <KnowledgeGraphPage claim={claim} setClaim={setClaim}/>}
      {active==='Evidence Library' && <EvidenceLibraryPage/>}
      {active==='Research Analytics' && <AnalyticsPage/>}
      {active==='History' && <HistoryPage recent={recent} reopen={runAnalysis} clear={()=>setRecent([])}/>}
      {active==='Settings' && <SettingsPage apiOnline={apiOnline}/>}
    </main>
  </div>
}

function PageHeading({eyebrow,title,subtitle}:{eyebrow:string;title:string;subtitle:string}) {
  return <div className="result-heading" style={{marginBottom:24}}><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>
}

function DashboardPage({dashboard,distribution,recent,claim,setClaim,loading,error,runAnalysis,openPage}:{
  dashboard:Dashboard|null; distribution:{label:string;value:number;color:string;percent:number}[]; recent:Recent[];
  claim:string;setClaim:(v:string)=>void;loading:boolean;error:string;runAnalysis:(v?:string)=>void;openPage:(v:string)=>void
}) {
  return <>
    <section className="hero-section">
      <div className="hero-copy"><div className="eyebrow">GOOD TO SEE YOU AGAIN</div><h1>Discover what the<br/><span>evidence</span> says.</h1><p>Investigate scientific claims using AI-powered research<br className="desktop-break"/> and reliable evidence from trusted sources.</p>
        <form className="claim-search" onSubmit={e=>{e.preventDefault();runAnalysis()}}><Search size={21}/><input value={claim} onChange={e=>setClaim(e.target.value)} placeholder="Enter a research claim..."/><button disabled={loading}>{loading?'Analyzing':'Analyze'} <ChevronRight size={19}/></button></form>
        {error&&<div className="error-line"><X size={14}/>{error}</div>}
        <div className="try-row"><Sparkles size={15}/><span>Try:</span>{suggestions.map(s=><button key={s} onClick={()=>{setClaim(s);runAnalysis(s)}}>{s.length>31?s.slice(0,28)+'…':s}</button>)}</div>
      </div><GlobeArt/>
    </section>
    <section className="metrics-grid">
      <Metric icon={<FileText/>} label="Total Papers" value={dashboard?dashboard.total_papers.toLocaleString():'—'} color="blue" note="Local SciFact corpus"/>
      <Metric icon={<Check/>} label="Annotated Claims" value={dashboard?dashboard.annotated_claims.toLocaleString():'—'} color="green" note="Claims with dataset annotations"/>
      <Metric icon={<GitFork/>} label="Evidence Types" value={dashboard?String(dashboard.evidence_types):'—'} color="purple" note="Support · Refute · Mixed · Insufficient"/>
      <Metric icon={<Target/>} label="External Research" value="PubMed" color="cyan" note="Optional live literature search"/>
    </section>
    <div className="dashboard-grid">
      <section className="panel verdict-panel"><PanelTitle icon={<BarChart3/>} title="Verdict Distribution"/><div className="verdict-content"><div className="donut" style={{background:`conic-gradient(${distribution.map((d,i)=>`${d.color} ${distribution.slice(0,i).reduce((s,x)=>s+x.percent,0)}% ${distribution.slice(0,i+1).reduce((s,x)=>s+x.percent,0)}%`).join(',')})`}}><div><b>{dashboard?dashboard.annotated_claims.toLocaleString():'—'}</b><span>Dataset claims</span></div></div><div className="legend">{distribution.map(d=><div key={d.label}><i style={{background:d.color}}/><span>{d.label}</span><b>{dashboard?`${d.percent}%`:'—'}</b></div>)}</div></div><p className="panel-note">Distribution of verdict categories in the local annotated dataset.</p></section>
      <section className="panel recent-panel"><PanelTitle icon={<Clock3/>} title="Recent Investigations" action="View all" onAction={()=>openPage('History')}/>{recent.length?recent.slice(0,3).map((item,i)=><button className="recent-row" key={`${item.claim}-${i}`} onClick={()=>runAnalysis(item.claim)}><span className={`verdict-pill ${verdictClass(item.verdict)}`}>{item.verdict}</span><span className="recent-claim">{item.claim}</span><span className="recent-time">{new Date(item.date).toLocaleDateString()}</span><ChevronRight size={17}/></button>):<div className="empty-recent"><History size={22}/><span>Your recent investigations will appear here.</span></div>}</section>
      <section className="panel explore-panel"><PanelTitle icon={<Sparkles/>} title="Explore Features"/><Feature icon={<Search/>} title="Investigate a Claim" sub="Analyze any research claim" onClick={()=>openPage('Investigate a Claim')}/><Feature icon={<GitFork/>} title="Knowledge Graph" sub="Explore paper connections" onClick={()=>openPage('Knowledge Graph')}/><Feature icon={<BarChart3/>} title="Research Analytics" sub="View dataset insights" onClick={()=>openPage('Research Analytics')}/></section>
      <section className="panel topics-panel"><PanelTitle icon={<BookOpen/>} title="Explore Research Topics" action="Explore" onAction={()=>openPage('Evidence Library')}/><div className="topic-grid">{topics.map(([name,growth,color])=><button className="topic-card" key={name} onClick={()=>{setClaim(name);openPage('Investigate a Claim')}}><b>{name}</b><span className={color}>{growth} <small>topic interest</small></span><div className={`sparkline ${color}`}><i/><i/><i/><i/><i/><i/><i/></div></button>)}</div></section>
    </div>
    <div className="data-footnote">{dashboard?.statistics_note || 'Dataset metrics are derived from the local SciFact corpus and annotations.'} Topic cards are navigation suggestions, not measured trend statistics.</div>
  </>
}

/* ------------------------------------------------------------------
   INTERACTIVE KNOWLEDGE GRAPH
   ------------------------------------------------------------------ */

function KnowledgeGraphPage({claim,setClaim}:{claim:string;setClaim:(v:string)=>void}) {
  const [graphType,setGraphType] = useState<'local'|'pubmed'>('local')
  const [graph,setGraph] = useState<GraphData|null>(null)
  const [loading,setLoading] = useState(false)
  const [error,setError] = useState('')
  const [selected,setSelected] = useState<GraphNode|null>(null)

  async function loadGraph(value=claim) {
    const clean=value.trim()
    if (!clean) { setError('Enter a claim before building its graph.'); return }
    setLoading(true);setError('');setSelected(null)
    try {
      const r=await fetch(`${API}/api/graph`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({claim:clean,graph_type:graphType,paper_count:graphType==='local'?10:5})})
      const data=await r.json()
      if(!r.ok) throw new Error(data.detail||'Could not build graph.')
      setGraph(data)
    } catch(e) {setError(e instanceof Error?e.message:'Graph request failed.')}
    finally {setLoading(false)}
  }

  const nodes=graph?.nodes||[]
  const papers=nodes.filter(n=>n.kind==='paper')

  return <section style={pageStyle}>
    <PageHeading eyebrow="CONNECTED RESEARCH" title="Knowledge graph" subtitle="Explore directed relationships between a scientific claim, retrieved papers and their evidence or research topics."/>

    <div style={{...cardStyle,display:'grid',gridTemplateColumns:'minmax(180px,1fr) auto auto',gap:12,alignItems:'center'}}>
      <input style={controlStyle} value={claim} onChange={e=>setClaim(e.target.value)} placeholder="Enter a scientific claim"/>
      <select style={controlStyle} value={graphType} onChange={e=>{setGraphType(e.target.value as 'local'|'pubmed');setGraph(null);setSelected(null)}}><option value="local">Local SciFact</option><option value="pubmed">PubMed</option></select>
      <button style={primaryButton} disabled={loading} onClick={()=>loadGraph()}>{loading?'Building…':'Build graph'} <GitFork size={16}/></button>
    </div>

    {error&&<p className="error-line"><X size={14}/>{error}</p>}
    {!graph&&!loading&&<div style={{...cardStyle,textAlign:'center',padding:44,color:'#9eb4d2'}}><Network size={34}/><h3 style={{color:'#eaf2ff'}}>Build a claim network</h3><p>Choose Local SciFact or PubMed, then build the graph to explore its connected records.</p></div>}
    {loading&&<div style={cardStyle}>Retrieving papers and building the network…</div>}

    {graph&&<>
      <div style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:16}}>
        <Metric icon={<Network/>} label="Graph nodes" value={String(nodes.length)} color="blue" note="Claim, papers and linked records"/>
        <Metric icon={<GitFork/>} label="Connections" value={String(graph.edges.length)} color="cyan" note="Directed API relationships"/>
        <Metric icon={<FileText/>} label="Papers" value={String(papers.length)} color="green" note={graphType==='local'?'Local SciFact retrieval':'PubMed retrieval'}/>
      </div>

      <div style={{...cardStyle,padding:16}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap',alignItems:'center',marginBottom:14}}>
          <div>
            <b style={{color:'#eaf2ff'}}>Claim → Papers → {graphType==='local'?'Annotated evidence':'Inferred topics'}</b>
            <div style={{fontSize:12,color:'#8fa9cb',marginTop:5}}>Drag nodes to rearrange · Scroll to zoom · Drag empty space to pan</div>
          </div>
          <div style={{display:'flex',gap:7}}>
            <GraphControl title="Zoom in" onClick={()=>window.dispatchEvent(new CustomEvent('rt-zoom',{detail:1.2}))}><ZoomIn size={16}/></GraphControl>
            <GraphControl title="Zoom out" onClick={()=>window.dispatchEvent(new CustomEvent('rt-zoom',{detail:0.83}))}><ZoomOut size={16}/></GraphControl>
            <GraphControl title="Reset view" onClick={()=>window.dispatchEvent(new CustomEvent('rt-reset'))}><Maximize2 size={16}/></GraphControl>
          </div>
        </div>

        <GraphCanvas graph={graph} graphType={graphType} selected={selected} onSelect={setSelected}/>

        <div style={{display:'flex',gap:16,flexWrap:'wrap',marginTop:14,fontSize:12,color:'#a8bdd8'}}>
          <LegendDot color="#2588f5" label="Claim"/>
          <LegendDot color="#16aaa2" label="Paper"/>
          {graphType==='local'?<>
            <LegendDot color="#16c79a" label="Supports"/>
            <LegendDot color="#f04462" label="Refutes"/>
            <LegendDot color="#9368e8" label="Mixed / other"/>
          </>:<LegendDot color="#d49a39" label="Inferred topic"/>}
        </div>
      </div>

      {graphType==='pubmed'&&<p style={{color:'#9fb8d8',fontSize:13,marginBottom:14}}><Info size={14} style={{display:'inline',verticalAlign:'middle'}}/> Topics are inferred from paper title and abstract keywords; they are not verified support for the claim. {graph.pubmed_count!==undefined?`PubMed reported ${graph.pubmed_count} matching records.`:''}</p>}
      {graph.search_error&&<p className="error-line">{graph.search_error}</p>}

      {selected&&<div style={cardStyle}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10}}>
          <div style={{display:'flex',alignItems:'center',gap:9}}>
            <span style={{width:9,height:9,borderRadius:'50%',background:graphNodeColor(selected),display:'inline-block'}}/>
            <b style={{color:'#eaf2ff'}}>Selected {selected.kind}</b>
          </div>
          <button onClick={()=>setSelected(null)} style={{...controlStyle,padding:'5px 9px'}}>Close</button>
        </div>
        <h3 style={{color:'#dceaff',lineHeight:1.5}}>{selected.details||selected.label}</h3>
        {selected.paper_id&&<p style={{color:'#9eb4d2'}}>Paper ID: {selected.paper_id}</p>}
        {selected.evidence_label&&<span className={`verdict-pill ${verdictClass(selected.evidence_label)}`}>{selected.evidence_label}</span>}
        {selected.sentence_index!==undefined&&<p style={{color:'#9eb4d2'}}>Sentence {selected.sentence_index+1}</p>}
        {selected.abstract&&<div style={{marginTop:12}}><b style={{color:'#a9c7ed'}}>Abstract</b><p style={{color:'#b9c9df',lineHeight:1.7,whiteSpace:'pre-wrap'}}>{selected.abstract}</p></div>}
        {selected.url&&<p><a href={selected.url} target="_blank" rel="noreferrer" style={{color:'#65b9f5',display:'inline-flex',gap:7,alignItems:'center'}}>Open original source <ExternalLink size={14}/></a></p>}
        <small style={{color:'#7f9bbb'}}>Node ID: {selected.id}</small>
      </div>}
    </>}
  </section>
}

function GraphControl({title,onClick,children}:{title:string;onClick:()=>void;children:React.ReactNode}) {
  return <button title={title} aria-label={title} onClick={onClick} style={{...controlStyle,padding:'8px 10px',display:'flex',alignItems:'center',cursor:'pointer'}}>{children}</button>
}
function LegendDot({color,label}:{color:string;label:string}) {
  return <span style={{display:'inline-flex',alignItems:'center',gap:6}}><i style={{width:9,height:9,borderRadius:'50%',background:color,display:'inline-block'}}/>{label}</span>
}

function graphNodeColor(node:GraphNode) {
  if(node.kind==='claim') return '#2588f5'
  if(node.kind==='paper') return '#16aaa2'
  if(node.kind==='topic') return '#d49a39'
  const verdict=(node.evidence_label||node.details||node.label||'').toLowerCase()
  if(verdict.includes('support')) return '#16c79a'
  if(verdict.includes('refute')||verdict.includes('contradict')) return '#f04462'
  if(verdict.includes('mixed')) return '#9368e8'
  return '#b28a56'
}

function GraphCanvas({graph,graphType,selected,onSelect}:{graph:GraphData;graphType:'local'|'pubmed';selected:GraphNode|null;onSelect:(node:GraphNode)=>void}) {
  const svgRef=useRef<SVGSVGElement|null>(null)
  const dragRef=useRef<{id:string}|null>(null)
  const panRef=useRef<{x:number;y:number;panX:number;panY:number}|null>(null)
  const [zoom,setZoom]=useState(1)
  const [pan,setPan]=useState({x:0,y:0})
  const [dragged,setDragged]=useState<Record<string,Point>>({})

  const nodes=graph.nodes||[]
  const papers=nodes.filter(n=>n.kind==='paper')
  const children=nodes.filter(n=>n.kind==='evidence'||n.kind==='topic')

  const basePositions=useMemo(()=>{
    const result:Record<string,Point>={}
    const claimNode=nodes.find(n=>n.kind==='claim')
    if(claimNode) result[claimNode.id]={x:95,y:285}

    papers.forEach((paper,index)=>{
      const y=papers.length===1?285:75+(index*(530/(papers.length-1)))
      result[paper.id]={x:455,y}
    })

    children.forEach((child,index)=>{
      const y=children.length===1?285:55+(index*(570/(children.length-1)))
      result[child.id]={x:900,y}
    })
    return result
  },[graph])

  useEffect(()=>{setDragged({});setZoom(1);setPan({x:0,y:0})},[graph])

  useEffect(()=>{
    function zoomEvent(event:Event) {
      const factor=(event as CustomEvent<number>).detail
      setZoom(v=>Math.max(.45,Math.min(2.5,v*factor)))
    }
    function resetEvent() {setZoom(1);setPan({x:0,y:0});setDragged({})}
    window.addEventListener('rt-zoom',zoomEvent)
    window.addEventListener('rt-reset',resetEvent)
    return ()=>{window.removeEventListener('rt-zoom',zoomEvent);window.removeEventListener('rt-reset',resetEvent)}
  },[])

  const position=(id:string)=>dragged[id]||basePositions[id]||{x:600,y:300}

  function pointerPosition(event:React.PointerEvent<SVGSVGElement>):Point {
    const rect=event.currentTarget.getBoundingClientRect()
    const sx=(event.clientX-rect.left)/rect.width*1200
    const sy=(event.clientY-rect.top)/rect.height*650
    return {x:(sx-pan.x)/zoom,y:(sy-pan.y)/zoom}
  }

  function onPointerDown(event:React.PointerEvent<SVGSVGElement>) {
    if(dragRef.current) return
    const p=pointerPosition(event)
    panRef.current={x:event.clientX,y:event.clientY,panX:pan.x,panY:pan.y}
    event.currentTarget.setPointerCapture(event.pointerId)
    void p
  }

  function onPointerMove(event:React.PointerEvent<SVGSVGElement>) {
    if(dragRef.current) {
      const p=pointerPosition(event)
      setDragged(old=>({...old,[dragRef.current!.id]:p}))
      return
    }
    if(panRef.current) {
      const rect=event.currentTarget.getBoundingClientRect()
      setPan({
        x:panRef.current.panX+(event.clientX-panRef.current.x)/rect.width*1200,
        y:panRef.current.panY+(event.clientY-panRef.current.y)/rect.height*650,
      })
    }
  }

  function onPointerUp() {
    dragRef.current=null
    panRef.current=null
  }

  function startNodeDrag(event:React.PointerEvent<SVGGElement>,node:GraphNode) {
    event.stopPropagation()
    event.preventDefault()
    onSelect(node)
    dragRef.current={id:node.id}
    const svg=svgRef.current
    if(svg) svg.setPointerCapture(event.pointerId)
  }

  function nodeText(node:GraphNode) {
    const value=node.details||node.label||node.id
    return value.length>43?value.slice(0,40)+'…':value
  }

  return <div style={{width:'100%',overflow:'hidden',borderRadius:12,border:'1px solid rgba(100,145,200,.18)',background:'radial-gradient(ellipse at 50% 45%,rgba(20,54,91,.35),rgba(5,13,26,.96))'}}>
    <svg
      ref={svgRef}
      viewBox="0 0 1200 650"
      role="img"
      aria-label="Interactive directed research knowledge graph"
      style={{width:'100%',height:'auto',minHeight:370,touchAction:'none',cursor:panRef.current?'grabbing':'grab',display:'block'}}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={e=>{e.preventDefault();setZoom(v=>Math.max(.45,Math.min(2.5,v*(e.deltaY<0?1.1:.9))))}}
    >
      <defs>
        <marker id="rt-arrow" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,8 L9,4 z" fill="#6d91ba"/>
        </marker>
        <pattern id="rt-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="1" fill="#55779d" opacity=".22"/>
        </pattern>
      </defs>
      <rect width="1200" height="650" fill="url(#rt-grid)"/>
      <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
        {graph.edges.map((edge,index)=>{
          const a=position(edge.source)
          const b=position(edge.target)
          const startX=a.x+105
          const endX=b.x-105
          const mid=(startX+endX)/2
          return <path key={`${edge.source}-${edge.target}-${index}`}
            d={`M ${startX} ${a.y} C ${mid} ${a.y}, ${mid} ${b.y}, ${endX} ${b.y}`}
            fill="none" stroke="#6d91ba" strokeWidth="2" opacity=".65" markerEnd="url(#rt-arrow)"/>
        })}

        {nodes.map(node=>{
          const p=position(node.id)
          const color=graphNodeColor(node)
          const active=selected?.id===node.id
          return <g key={node.id}
            transform={`translate(${p.x},${p.y})`}
            onPointerDown={event=>startNodeDrag(event,node)}
            onClick={()=>onSelect(node)}
            style={{cursor:'grab'}}
          >
            <rect x="-105" y="-39" width="210" height="78" rx="13"
              fill={active?'#183657':'#0b192d'}
              stroke={active?'#ffffff':color}
              strokeWidth={active?3:1.8}
              filter={active?'url(#none)':undefined}/>
            <rect x="-105" y="-39" width="5" height="78" rx="2" fill={color}/>
            <text x="-89" y="-15" fill={color} fontSize="11" fontWeight="700" letterSpacing="1">
              {node.kind.toUpperCase()}
            </text>
            <text x="-89" y="8" fill="#e6f0ff" fontSize="12" fontWeight="600">
              {nodeText(node).slice(0,31)}
            </text>
            <text x="-89" y="25" fill="#819dbd" fontSize="10">
              {node.kind==='paper'?`Paper ID: ${node.paper_id||'—'}`:
                node.kind==='evidence'?(node.evidence_label||'Annotated sentence'):
                node.kind==='topic'?'Inferred topic':'Research question'}
            </text>
            <circle cx="91" cy="-27" r="5" fill={color}/>
          </g>
        })}
      </g>
      <text x="95" y="625" fill="#6886a8" fontSize="12">CLAIM</text>
      <text x="455" y="625" fill="#6886a8" fontSize="12" textAnchor="middle">RESEARCH PAPERS</text>
      <text x="900" y="625" fill="#6886a8" fontSize="12" textAnchor="middle">{graphType==='local'?'ANNOTATED EVIDENCE':'INFERRED TOPICS'}</text>
    </svg>
  </div>
}

function EvidenceLibraryPage() {
  const [data,setData]=useState<EvidenceResponse|null>(null)
  const [query,setQuery]=useState('')
  const [label,setLabel]=useState('all')
  const [offset,setOffset]=useState(0)
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const limit=25

  async function load(nextOffset=offset) {
    setLoading(true);setError('')
    try {
      const params=new URLSearchParams({q:query,label,limit:String(limit),offset:String(nextOffset)})
      const r=await fetch(`${API}/api/evidence?${params}`)
      const result=await r.json()
      if(!r.ok) throw new Error(result.detail||'Could not load evidence.')
      setData(result);setOffset(nextOffset)
    } catch(e) {setError(e instanceof Error?e.message:'Evidence request failed.')}
    finally {setLoading(false)}
  }
  useEffect(()=>{load(0)},[label])
  const totalPages=data?Math.max(1,Math.ceil(data.total/limit)):1
  const page=Math.floor(offset/limit)+1
  return <section style={pageStyle}>
    <PageHeading eyebrow="SCIFACT ANNOTATIONS" title="Evidence library" subtitle="Search the sentence-level evidence annotations stored in your local SciFact training dataset."/>
    <div style={{...cardStyle,display:'grid',gridTemplateColumns:'minmax(180px,1fr) 190px auto',gap:10}}>
      <input style={controlStyle} value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==='Enter'&&load(0)} placeholder="Search claim, paper, ID or sentence"/>
      <select style={controlStyle} value={label} onChange={e=>setLabel(e.target.value)}><option value="all">All labels</option><option value="SUPPORT">Support</option><option value="CONTRADICT">Contradict</option></select>
      <button style={primaryButton} onClick={()=>load(0)} disabled={loading}><Search size={15}/> Search</button>
    </div>
    {error&&<p className="error-line"><X size={14}/>{error}</p>}
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',margin:'14px 2px',color:'#9fb5d4',fontSize:13}}><span>{data?`${data.total.toLocaleString()} matching evidence records`:'Loading evidence records…'}</span><span>Page {page} of {totalPages}</span></div>
    {loading&&!data&&<div style={cardStyle}>Loading annotated evidence…</div>}
    {data?.items.map((item,i)=><article key={`${item.paper_id}-${item.sentence_index}-${i}`} style={cardStyle}>
      <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',marginBottom:10}}><span className={`verdict-pill ${verdictClass(item.label)}`}>{item.label}</span><small style={{color:'#8fa9cb'}}>Paper {item.paper_id} · Sentence {(item.sentence_index??0)+1} · {item.source||'SciFact'}</small></div>
      <p style={{color:'#e0ebfa',lineHeight:1.65,margin:'8px 0 12px'}}>{item.sentence}</p>
      <b style={{color:'#a9c7ed',fontSize:14}}>{item.title}</b>
      {item.claim&&<p style={{color:'#8fa9cb',fontSize:13,marginBottom:0}}>Associated claim: {item.claim}</p>}
    </article>)}
    {data&&data.items.length===0&&<div style={cardStyle}>No evidence records match these filters.</div>}
    <div style={{display:'flex',justifyContent:'space-between',marginTop:18}}><button style={controlStyle} disabled={loading||offset===0} onClick={()=>load(Math.max(0,offset-limit))}>← Previous</button><button style={controlStyle} disabled={loading||!data||offset+limit>=data.total} onClick={()=>load(offset+limit)}>Next →</button></div>
  </section>
}

function AnalyticsPage() {
  const [data,setData]=useState<Analytics|null>(null)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  async function refresh() {
    setLoading(true);setError('')
    try {const r=await fetch(`${API}/api/analytics`);const d=await r.json();if(!r.ok)throw new Error(d.detail||'Analytics request failed.');setData(d)}
    catch(e){setError(e instanceof Error?e.message:'Could not load analytics.')}
    finally{setLoading(false)}
  }
  useEffect(()=>{refresh()},[])
  const verdicts=Object.entries(data?.verdict_distribution||{})
  const maxVerdict=Math.max(1,...verdicts.map(([,v])=>v))
  const labels=Object.entries(data?.annotation_label_counts||{})
  const maxLabel=Math.max(1,...labels.map(([,v])=>v))
  return <section style={pageStyle}>
    <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'start',flexWrap:'wrap'}}><PageHeading eyebrow="DATASET OVERVIEW" title="Research analytics" subtitle="Explore descriptive statistics from the SciFact corpus and its training annotations."/><button style={controlStyle} onClick={refresh} disabled={loading}><RefreshCw size={15}/> Refresh</button></div>
    {error&&<p className="error-line">{error}</p>}
    {loading&&!data&&<div style={cardStyle}>Calculating dataset statistics…</div>}
    {data&&<>
      <div className="metrics-grid">
        <Metric icon={<FileText/>} label="Corpus papers" value={data.total_papers.toLocaleString()} color="blue" note="Records in SciFact corpus"/>
        <Metric icon={<Check/>} label="Annotated claims" value={data.annotated_claims.toLocaleString()} color="green" note="Training claim records"/>
        <Metric icon={<FlaskConical/>} label="Evidence sentences" value={data.total_annotated_sentence_references.toLocaleString()} color="purple" note="Annotated sentence references"/>
        <Metric icon={<Target/>} label="Annotation labels" value={String(labels.length)} color="cyan" note="Distinct annotation categories"/>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(290px,1fr))',gap:16}}>
        <div style={cardStyle}><h3 style={{color:'#eaf2ff',marginTop:0}}>Claim verdict distribution</h3>{verdicts.map(([name,value])=><div key={name} style={{margin:'17px 0'}}><div style={{display:'flex',justifyContent:'space-between',color:'#b9cce4',fontSize:13}}><span>{name}</span><b>{value.toLocaleString()}</b></div><div style={barTrack}><div style={{...barFill,width:`${value/maxVerdict*100}%`}}/></div></div>)}</div>
        <div style={cardStyle}><h3 style={{color:'#eaf2ff',marginTop:0}}>Evidence annotation labels</h3>{labels.map(([name,value])=><div key={name} style={{margin:'17px 0'}}><div style={{display:'flex',justifyContent:'space-between',color:'#b9cce4',fontSize:13}}><span>{name}</span><b>{value.toLocaleString()}</b></div><div style={barTrack}><div style={{...barFill,width:`${value/maxLabel*100}%`,background:'linear-gradient(90deg,#8a62e8,#39b8d5)'}}/></div></div>)}</div>
      </div>
      <div style={cardStyle}><h3 style={{color:'#eaf2ff',marginTop:0}}>Papers with most annotated evidence</h3>{data.top_evidence_papers.map((p,i)=><div key={p.paper_id} style={{display:'grid',gridTemplateColumns:'34px minmax(0,1fr) auto',gap:12,alignItems:'center',padding:'13px 0',borderBottom:'1px solid rgba(123,158,205,.12)'}}><b style={{color:'#6ea9ef'}}>#{i+1}</b><div><b style={{color:'#dceaff',fontSize:14}}>{p.title}</b><small style={{display:'block',color:'#8fa9cb',marginTop:4}}>Paper ID: {p.paper_id}</small></div><span style={{color:'#9bd8e6',fontWeight:700}}>{p.evidence_sentence_count}</span></div>)}</div>
      <p style={{color:'#8fa9cb',fontSize:12,lineHeight:1.6}}><Info size={14} style={{display:'inline',verticalAlign:'middle'}}/> {data.note}</p>
    </>}
  </section>
}
const barTrack:React.CSSProperties={height:8,background:'#14243b',borderRadius:20,overflow:'hidden',marginTop:8}
const barFill:React.CSSProperties={height:'100%',background:'linear-gradient(90deg,#1478ed,#16b8d2)',borderRadius:20}

function HistoryPage({recent,reopen,clear}:{recent:Recent[];reopen:(v:string)=>void;clear:()=>void}) {
  return <section style={pageStyle}><div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'start',flexWrap:'wrap'}}><PageHeading eyebrow="YOUR ACTIVITY" title="Investigation history" subtitle="Recent claims investigated in this browser are stored locally on this device."/>{recent.length>0&&<button style={controlStyle} onClick={clear}>Clear history</button>}</div>
    {recent.length?recent.map((item,i)=><button key={`${item.claim}-${i}`} onClick={()=>reopen(item.claim)} style={{...cardStyle,width:'100%',textAlign:'left',display:'grid',gridTemplateColumns:'minmax(0,1fr) auto',gap:12,cursor:'pointer',color:'#eaf2ff'}}><div><span className={`verdict-pill ${verdictClass(item.verdict)}`}>{item.verdict}</span><p style={{margin:'12px 0 5px'}}>{item.claim}</p><small style={{color:'#8fa9cb'}}>{new Date(item.date).toLocaleString()}</small></div><ChevronRight/></button>):<div style={{...cardStyle,textAlign:'center',padding:40,color:'#9fb5d4'}}><History size={30}/><h3 style={{color:'#eaf2ff'}}>No investigations yet</h3><p>Claims you analyze will appear here.</p></div>}
  </section>
}

function SettingsPage({apiOnline}:{apiOnline:boolean}) {
  return <section style={pageStyle}><PageHeading eyebrow="APPLICATION CONFIGURATION" title="Settings" subtitle="Basic information about this local ResearchTrace frontend and its connected API."/>
    <div style={cardStyle}><h3 style={{color:'#eaf2ff',marginTop:0}}>Connection</h3><div style={{display:'flex',alignItems:'center',gap:10,color:'#b9cce4'}}><span className={`status-dot ${apiOnline?'online':''}`}/>{apiOnline?'Backend API is reachable':'Backend API is not reachable'}</div><p style={{color:'#8fa9cb',fontSize:13}}>API base URL: <code>{API}</code></p></div>
    <div style={cardStyle}><h3 style={{color:'#eaf2ff',marginTop:0}}>Data sources</h3><p style={{color:'#b9c9df',lineHeight:1.7}}>Local evidence and dataset analytics are based on the SciFact corpus and its annotations. External literature search uses PubMed through the backend API.</p><p style={{color:'#8fa9cb',fontSize:13}}>Investigation history is stored in this browser's local storage. Clearing browser site data may remove it.</p></div>
    <div style={cardStyle}><h3 style={{color:'#eaf2ff',marginTop:0}}>Scientific interpretation</h3><p style={{color:'#b9c9df',lineHeight:1.7}}>An exact annotated SciFact claim match provides the dataset verdict. For claims without an exact match, retrieved-paper similarity is a relevance ranking score, not a probability or truth score. PubMed search results and keyword-inferred graph topics are not automatically evidence that a claim is true or false.</p></div>
  </section>
}

function ResultsView({claim,analysis,pubmed,onBack}:{claim:string;analysis:Analysis;pubmed:PubmedPaper[];onBack:()=>void}) {
  return <section className="results-page"><button className="back-link" onClick={onBack}>← Back to dashboard</button><div className="result-heading"><div className="eyebrow">CLAIM INVESTIGATION</div><h1>Evidence <span>report</span></h1><p>{claim}</p></div>
    <div className={`result-verdict ${verdictClass(analysis.verdict)}`}><div className="result-verdict-icon"><ShieldCheck size={25}/></div><div><small>LOCAL SCIFACT VERDICT</small><h2>{analysis.verdict}</h2><p>{analysis.message}</p></div><span className={`match-tag ${analysis.exact_match?'matched':'unmatched'}`}>{analysis.exact_match?'Exact dataset match':'No exact dataset match'}</span></div>
    <div className="result-stats"><div><b>{analysis.evidence.length}</b><span>Annotated evidence sentences</span></div><div><b>{analysis.papers.length}</b><span>Local papers retrieved</span></div><div><b>{pubmed.length}</b><span>PubMed papers retrieved</span></div></div>
    <section className="panel result-panel"><PanelTitle icon={<FlaskConical/>} title="Annotated Evidence"/>{analysis.evidence.length?analysis.evidence.map((e,i)=><article className="evidence-item" key={`${e.paper_id}-${e.sentence_index}-${i}`}><div><span className={`verdict-pill ${verdictClass(e.label)}`}>{e.label}</span><small>Paper ID: {e.paper_id} · Sentence {e.sentence_index+1}</small></div><p>{e.sentence}</p><b>{e.title}</b></article>):<p className="muted-copy">No annotated evidence sentences were found for an exact claim match. Related literature is shown below for exploration only.</p>}</section>
    <section className="panel result-panel"><PanelTitle icon={<BookOpen/>} title="Local Research Papers"/>{analysis.papers.length?analysis.papers.map((p,i)=><article className="paper-item" key={p.doc_id||i}><div><b>{p.title||'Untitled paper'}</b><small>Paper ID: {p.doc_id||'—'} {p.is_annotated_source?'· Annotated evidence source':''}</small></div><span className="score">{typeof p.similarity==='number'?`Relevance ${p.similarity.toFixed(3)}`:'—'}</span><p>{p.abstract||'No abstract available.'}</p></article>):<p className="muted-copy">No local papers were retrieved for this claim.</p>}</section>
    <section className="panel result-panel"><PanelTitle icon={<Activity/>} title="PubMed Literature"/>{pubmed.length?pubmed.map((p,i)=><article className="paper-item" key={p.pmid||i}><div><b>{p.title||'Untitled paper'}</b><small>{p.journal||'Journal not provided'} · {p.publication_date||'Date unavailable'} · PMID {p.pmid||'—'}</small></div>{p.url&&<a href={p.url} target="_blank" rel="noreferrer">Open PubMed ↗</a>}<p>{p.abstract||'No abstract available.'}</p></article>):<p className="muted-copy">No PubMed papers returned. This can happen when the search finds no records or PubMed is temporarily unavailable.</p>}</section>
    <p className="interpretation-note">Important: retrieval similarity is a ranking score, not a probability or truth score. PubMed search results are related literature, not automatically supporting evidence.</p>
  </section>
}
