import React, { useState, useEffect, useRef } from 'react';

const API_URL = 'http://127.0.0.1:8000';

function App() {
  const [colleges, setColleges] = useState([]);
  const [branches, setBranches] = useState([]);
  const [categories, setCategories] = useState(['OC', 'BC', 'BCM', 'MBC', 'SC', 'SCA', 'ST']);
  const [initialLoading, setInitialLoading] = useState(true);
  const [predictLoading, setPredictLoading] = useState(false);
  const [trendLoading, setTrendLoading] = useState(false);
  const [error, setError] = useState(null);
  const [category, setCategory] = useState('OC');
  const [studentMark, setStudentMark] = useState('');
  const [collegeSearch, setCollegeSearch] = useState('');
  const [selectedCollege, setSelectedCollege] = useState(null);
  const [branchSearch, setBranchSearch] = useState('');
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [showCollegeDropdown, setShowCollegeDropdown] = useState(false);
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const [grouped, setGrouped] = useState(null);
  const [resultMessage, setResultMessage] = useState('');
  const [activeTrend, setActiveTrend] = useState(null);
  const [trendData, setTrendData] = useState(null);
  const [trendError, setTrendError] = useState(null);
  const [expandedColleges, setExpandedColleges] = useState({});

  const collegeRef = useRef(null);
  const branchRef = useRef(null);

  useEffect(() => {
    async function initData() {
      try {
        setInitialLoading(true);
        const [cRes, bRes, catRes] = await Promise.all([
          fetch(`${API_URL}/colleges`).then(r => r.ok ? r.json() : []),
          fetch(`${API_URL}/branches`).then(r => r.ok ? r.json() : []),
          fetch(`${API_URL}/categories`).then(r => r.ok ? r.json() : ['OC','BC','BCM','MBC','SC','SCA','ST']),
        ]);
        setColleges(cRes); setBranches(bRes); setCategories(catRes);
      } catch { setError("Could not connect to backend. Ensure it's running on port 8000."); }
      finally { setInitialLoading(false); }
    }
    initData();
  }, []);

  useEffect(() => {
    function handler(e) {
      if (collegeRef.current && !collegeRef.current.contains(e.target)) setShowCollegeDropdown(false);
      if (branchRef.current && !branchRef.current.contains(e.target)) setShowBranchDropdown(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filteredColleges = collegeSearch.trim() === '' ? [] :
    colleges.filter(c => c.name.toLowerCase().includes(collegeSearch.toLowerCase()) || c.code.includes(collegeSearch)).slice(0, 10);

  const filteredBranches = branchSearch.trim() === '' ? [] :
    branches.filter(b => b.name.toLowerCase().includes(branchSearch.toLowerCase())).slice(0, 10);

  const handlePredict = async (e) => {
    e.preventDefault();
    const mark = parseFloat(studentMark);
    if (!studentMark || isNaN(mark) || mark < 0 || mark > 200) {
      setError("Please enter a valid cutoff mark between 0 and 200."); return;
    }
    try {
      let finalCollegeId = selectedCollege?.id ?? null;
      if (!finalCollegeId && collegeSearch.trim() !== '') {
        const exactMatch = colleges.find(c => c.code === collegeSearch.trim() || c.name.toLowerCase() === collegeSearch.trim().toLowerCase());
        if (exactMatch) finalCollegeId = exactMatch.id;
        else {
          // If no exact match, try partial match for code
          const partialMatch = colleges.find(c => c.code.includes(collegeSearch.trim()));
          if (partialMatch) finalCollegeId = partialMatch.id;
        }
      }

      let finalBranchId = selectedBranch?.id ?? null;
      if (!finalBranchId && branchSearch.trim() !== '') {
        const exactMatch = branches.find(b => b.name.toLowerCase() === branchSearch.trim().toLowerCase());
        if (exactMatch) finalBranchId = exactMatch.id;
        else {
          const partialMatch = branches.find(b => b.name.toLowerCase().includes(branchSearch.trim().toLowerCase()));
          if (partialMatch) finalBranchId = partialMatch.id;
        }
      }

      const res = await fetch(`${API_URL}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category, student_mark: mark,
          college_code: finalCollegeId,
          branch_name: finalBranchId,
          top_n: 100, min_probability: 10.0,
        }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Prediction failed.'); }
      const data = await res.json();
      setGrouped(data.grouped);
      setResultMessage(data.message);
      // Auto-expand top 3 colleges
      const autoExpand = {};
      (data.grouped || []).slice(0, 3).forEach(g => { autoExpand[g.college_code] = true; });
      setExpandedColleges(autoExpand);
    } catch (err) { setError(err.message); }
    finally { setPredictLoading(false); }
  };

  const toggleCollege = (code) => setExpandedColleges(prev => ({ ...prev, [code]: !prev[code] }));

  const handleViewTrend = async (item) => {
    setActiveTrend(item); setTrendLoading(true); setTrendError(null); setTrendData(null);
    try {
      const res = await fetch(`${API_URL}/trends?college_id=${item.college_id}&branch_id=${item.branch_id}&category=${category}`);
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Could not fetch trend.'); }
      setTrendData(await res.json());
    } catch (err) { setTrendError(err.message); }
    finally { setTrendLoading(false); }
  };

  const renderTrendChart = () => {
    if (!trendData?.trends?.length) return null;
    const data = trendData.trends;
    const pad = { top: 30, right: 40, bottom: 40, left: 55 };
    const W = 500, H = 220;
    const years = data.map(t => t.year);
    const marks = data.map(t => t.closing_mark);
    const minY = Math.max(0, Math.min(...marks) - 5);
    const maxY = Math.min(200, Math.max(...marks) + 5);
    const minX = Math.min(...years), maxX = Math.max(...years);
    const xR = maxX - minX || 1, yR = maxY - minY || 1;
    const gx = yr => pad.left + ((yr - minX) / xR) * (W - pad.left - pad.right);
    const gy = m => H - pad.bottom - ((m - minY) / yR) * (H - pad.top - pad.bottom);
    const pts = data.map(t => ({ x: gx(t.year), y: gy(t.closing_mark) }));
    const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    return (
      <div className="chart-container">
        <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg">
          {[0,1,2,3,4].map(i => { const v = minY + i*(yR/4); return (
            <g key={i}>
              <line x1={pad.left} y1={gy(v)} x2={W-pad.right} y2={gy(v)} className="chart-grid-line"/>
              <text x={pad.left-8} y={gy(v)+4} textAnchor="end" className="chart-text">{v.toFixed(1)}</text>
            </g>
          );})}
          {data.map((t,i) => <text key={i} x={gx(t.year)} y={H-pad.bottom+18} textAnchor="middle" className="chart-text">{t.year}</text>)}
          <path d={pathD} className="chart-line"/>
          {pts.map((pt, i) => (
            <g key={i}>
              <circle cx={pt.x} cy={pt.y} r="5" className="chart-point"/>
              <text x={pt.x} y={pt.y-10} textAnchor="middle" className="chart-text chart-label-value">{data[i].closing_mark.toFixed(1)}</text>
            </g>
          ))}
          <line x1={pad.left} y1={pad.top} x2={pad.left} y2={H-pad.bottom} className="chart-axis"/>
          <line x1={pad.left} y1={H-pad.bottom} x2={W-pad.right} y2={H-pad.bottom} className="chart-axis"/>
        </svg>
      </div>
    );
  };

  const getBadge = (level) => {
    if (level.includes('Safe')) return 'badge-high';
    if (level.includes('Competitive')) return 'badge-medium';
    return 'badge-low';
  };
  const getColor = (pct) => pct >= 80 ? 'var(--success)' : pct >= 50 ? 'var(--warning)' : 'var(--danger)';

  if (initialLoading) return (
    <div className="loading-spinner-container">
      <div className="spinner"></div>
      <p>Connecting to database and initializing models...</p>
    </div>
  );

  return (
    <>
      <header className="header">
        <h1>TNEA College Predictor</h1>
        <p>Enter your cutoff marks and category to predict admission probabilities</p>
      </header>

      <main style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {error && <div className="error-message">{error}</div>}

        {/* Form */}
        <section className="card">
          <form onSubmit={handlePredict}>
            <div className="form-grid">
              <div className="form-group">
                <label htmlFor="studentMark">Cutoff Mark (0 - 200) <span>*</span></label>
                <input id="studentMark" type="number" step="0.01" min="0" max="200"
                  placeholder="e.g. 185.50" className="input-control"
                  value={studentMark} onChange={e => setStudentMark(e.target.value)} required/>
              </div>
              <div className="form-group">
                <label htmlFor="category">Reservation Category <span>*</span></label>
                <select id="category" className="input-control" value={category} onChange={e => setCategory(e.target.value)} required>
                  {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </div>
              <div className="form-group" ref={collegeRef}>
                <label htmlFor="collegeInput">Preferred College (Optional)</label>
                <div className="autocomplete-container">
                  <input id="collegeInput" type="text" placeholder="Search by code or name..."
                    className="input-control" value={collegeSearch}
                    onChange={e => { setCollegeSearch(e.target.value); setShowCollegeDropdown(true); if (selectedCollege) setSelectedCollege(null); }}
                    onFocus={() => setShowCollegeDropdown(true)}/>
                  {showCollegeDropdown && filteredColleges.length > 0 && (
                    <ul className="autocomplete-dropdown">
                      {filteredColleges.map(c => (
                        <li key={c.id} className="autocomplete-item" onClick={() => { setCollegeSearch(`[${c.code}] ${c.name}`); setSelectedCollege(c); setShowCollegeDropdown(false); }}>
                          <strong>{c.code}</strong> - {c.name}
                        </li>
                      ))}
                    </ul>
                  )}
                  {showCollegeDropdown && collegeSearch.trim() !== '' && filteredColleges.length === 0 && (
                    <div className="autocomplete-dropdown autocomplete-no-results">No colleges match your search</div>
                  )}
                </div>
              </div>
              <div className="form-group" ref={branchRef}>
                <label htmlFor="branchInput">Preferred Course / Branch (Optional)</label>
                <div className="autocomplete-container">
                  <input id="branchInput" type="text" placeholder="Search branch name..."
                    className="input-control" value={branchSearch}
                    onChange={e => { setBranchSearch(e.target.value); setShowBranchDropdown(true); if (selectedBranch) setSelectedBranch(null); }}
                    onFocus={() => setShowBranchDropdown(true)}/>
                  {showBranchDropdown && filteredBranches.length > 0 && (
                    <ul className="autocomplete-dropdown">
                      {filteredBranches.map(b => (
                        <li key={b.id} className="autocomplete-item" onClick={() => { setBranchSearch(b.name); setSelectedBranch(b); setShowBranchDropdown(false); }}>
                          {b.name}
                        </li>
                      ))}
                    </ul>
                  )}
                  {showBranchDropdown && branchSearch.trim() !== '' && filteredBranches.length === 0 && (
                    <div className="autocomplete-dropdown autocomplete-no-results">No courses match your search</div>
                  )}
                </div>
              </div>
            </div>
            <button type="submit" className="btn btn-primary" disabled={predictLoading}>
              {predictLoading ? <><div className="spinner" style={{width:'16px',height:'16px',borderWidth:'2px'}}></div> Calculating...</> : 'Predict Admission Chances'}
            </button>
          </form>
        </section>

        {/* Trend Viewer */}
        {activeTrend && (
          <section className="card trends-section">
            <div className="trends-header-row">
              <button className="btn-text" onClick={() => setActiveTrend(null)}
                style={{padding:'4px 8px',fontSize:'14px',border:'1px solid var(--border)'}}>
                &larr; Back to Results
              </button>
              <h2 style={{fontSize:'20px',margin:0}}>Cutoff Trend Analysis</h2>
            </div>
            {trendLoading && <div className="loading-spinner-container" style={{padding:'24px'}}><div className="spinner"></div><p>Loading...</p></div>}
            {trendError && <div className="error-message" style={{margin:0}}>{trendError}</div>}
            {trendData && (
              <div className="trends-chart-card">
                <div className="trends-meta">
                  <p style={{fontWeight:600,color:'var(--text-heading)',fontSize:'15px'}}>{trendData.college_name}</p>
                  <p style={{color:'var(--text-muted)',fontSize:'13px',marginTop:'4px'}}>
                    {trendData.branch_name} | Category: <span style={{fontWeight:600,color:'var(--text-heading)'}}>{category}</span>
                  </p>
                </div>
                {renderTrendChart()}
                <div style={{overflowX:'auto'}}>
                  <table className="trends-table">
                    <thead><tr><th>Year</th><th>Closing Mark</th><th>Your Mark</th><th>Gap</th></tr></thead>
                    <tbody>
                      {trendData.trends.map(t => {
                        const diff = parseFloat(studentMark) - t.closing_mark;
                        return (
                          <tr key={t.year}>
                            <td style={{fontWeight:600}}>{t.year}</td>
                            <td>{t.closing_mark.toFixed(2)}</td>
                            <td>{parseFloat(studentMark).toFixed(2)}</td>
                            <td className={diff >= 0 ? 'stat-gap-positive' : 'stat-gap-negative'} style={{fontWeight:600}}>
                              {diff >= 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Grouped Results */}
        {grouped && !activeTrend && (
          <section className="card" style={{display:'flex',flexDirection:'column',gap:'16px'}}>
            <div className="results-header">
              <span className="results-count">{resultMessage}</span>
              <span style={{fontSize:'13px',color:'var(--text-muted)'}}>
                Grouped by: <strong>College Code</strong>
              </span>
            </div>

            {grouped.length === 0 ? (
              <div style={{textAlign:'center',padding:'36px',color:'var(--text-muted)'}}>
                No colleges match the criteria. Try adjusting your filters.
              </div>
            ) : (
              <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
                {grouped.map((group, gi) => {
                  const isOpen = !!expandedColleges[group.college_code];
                  const best = group.best_probability;
                  const color = getColor(best);
                  return (
                    <div key={gi} className="college-group-card">
                      {/* College Header Row */}
                      <div className="college-group-header" onClick={() => toggleCollege(group.college_code)}>
                        <div className="college-group-left">
                          <span className="college-code-badge">Code {group.college_code}</span>
                          <div>
                            <div className="college-name" style={{marginBottom:'4px'}}>{group.college_name}</div>
                            <div style={{display:'flex',gap:'16px',flexWrap:'wrap'}}>
                              {group.num_branches != null && (
                                <span style={{fontSize:'12px',color:'var(--text-muted)'}}>
                                  <strong>{group.num_branches}</strong> branches offered
                                </span>
                              )}
                              {group.avg_oc_cutoff != null && (
                                <span style={{fontSize:'12px',color:'var(--text-muted)'}}>
                                  Avg OC cutoff: <strong>{group.avg_oc_cutoff.toFixed(2)}</strong>
                                </span>
                              )}
                              <span style={{fontSize:'12px',color:'var(--text-muted)'}}>
                                <strong>{group.branches.length}</strong> matching {group.branches.length === 1 ? 'branch' : 'branches'}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="college-group-right">
                          <div style={{textAlign:'right'}}>
                            <div style={{fontSize:'22px',fontWeight:700,color}}>
                              {best}%
                            </div>
                            <div style={{fontSize:'11px',color:'var(--text-muted)'}}>best chance</div>
                          </div>
                          {/* Expand/collapse indicator */}
                          <div style={{
                            width:'28px',height:'28px',borderRadius:'50%',
                            background:'var(--surface-2)',display:'flex',
                            alignItems:'center',justifyContent:'center',
                            fontSize:'14px',color:'var(--text-muted)',
                            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                            transition:'transform 0.2s ease',flexShrink:0,
                          }}>▼</div>
                        </div>
                      </div>

                      {/* Branch Cards (expandable) */}
                      {isOpen && (
                        <div className="college-group-branches">
                          {group.branches.map((item, bi) => {
                            const pct = item.probability_percentage;
                            const bcolor = getColor(pct);
                            return (
                              <div className="branch-item-card" key={bi}>
                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'12px',flexWrap:'wrap'}}>
                                  <div>
                                    <p className="branch-name" style={{margin:0,fontWeight:600}}>{item.branch_name}</p>
                                    <span className={`badge ${getBadge(item.confidence_level)}`} style={{marginTop:'4px',display:'inline-block'}}>
                                      {item.confidence_level}
                                    </span>
                                  </div>
                                  <div style={{textAlign:'right',flexShrink:0}}>
                                    <div style={{fontSize:'20px',fontWeight:700,color:bcolor}}>{pct}%</div>
                                    <div style={{fontSize:'11px',color:'var(--text-muted)'}}>probability</div>
                                  </div>
                                </div>

                                <div className="probability-bar-track" style={{marginTop:'8px'}}>
                                  <div className="probability-bar-fill" style={{width:`${pct}%`,backgroundColor:bcolor}}></div>
                                </div>

                                <div className="stats-grid" style={{marginTop:'10px'}}>
                                  <div className="stat-box">
                                    <div className="stat-value">{item.student_mark.toFixed(2)}</div>
                                    <div className="stat-label">Your Mark</div>
                                  </div>
                                  <div className="stat-box">
                                    <div className="stat-value">{item.predicted_cutoff.toFixed(2)}</div>
                                    <div className="stat-label">Est. Cutoff</div>
                                  </div>
                                  <div className="stat-box">
                                    <div className={`stat-value ${item.mark_gap >= 0 ? 'stat-gap-positive' : 'stat-gap-negative'}`}>
                                      {item.mark_gap >= 0 ? `+${item.mark_gap.toFixed(2)}` : item.mark_gap.toFixed(2)}
                                    </div>
                                    <div className="stat-label">Gap</div>
                                  </div>
                                </div>

                                <div className="card-actions" style={{paddingTop:'8px',borderTop:'1px solid var(--border)',marginTop:'8px'}}>
                                  <button className="btn-text" onClick={() => handleViewTrend(item)}>
                                    View Cutoff History
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M3 3v18h18"/><path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3"/>
                                    </svg>
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </main>
    </>
  );
}

export default App;
