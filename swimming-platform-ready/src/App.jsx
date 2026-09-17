import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import * as XLSX from 'xlsx'
import './App.css'

const emptySwimmer = {
  registration_number: '',
  first_name: '',
  last_name: '',
  birth_date: '',
  birth_place: '',
  gender: 'ذكر',
  phone: '',
  category: '',
  club_id: '',
  status: 'نشط',
  photo_url: '',
  document_url: '',
}

const emptyClub = { 
  name: '', 
  city: '', 
  phone: '', 
  email: '', 
  logo_url: '',
  admin_first_name: '',
  admin_last_name: '',
  admin_email: '',
  admin_password: ''
}

function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activePage, setActivePage] = useState('dashboard')
  const [stats, setStats] = useState({ clubs: 0, swimmers: 0, competitions: 0, registrations: 0 })

  const [clubs, setClubs] = useState([])
  const [swimmers, setSwimmers] = useState([])
  const [competitions, setCompetitions] = useState([])
  const [clubSearch, setClubSearch] = useState('')
  const [swimmerSearch, setSwimmerSearch] = useState('')
  const [swimmerClubFilter, setSwimmerClubFilter] = useState('')
  const [swimmerStatusFilter, setSwimmerStatusFilter] = useState('')
  const [competitionSearch, setCompetitionSearch] = useState('')
  const [clubModal, setClubModal] = useState(null)
  const [swimmerModal, setSwimmerModal] = useState(null)
  const [cardSwimmer, setCardSwimmer] = useState(null) // للبطاقة
  const [clubForm, setClubForm] = useState(emptyClub)
  const [swimmerForm, setSwimmerForm] = useState(emptySwimmer)
  const [swimmerFile, setSwimmerFile] = useState(null)
  const [error, setError] = useState('')

  const isFederationAdmin = profile?.role === 'federation_admin'
  const isClubAdmin = profile?.role === 'club_admin'

  const genderToDb = (value) => value === 'أنثى' ? 'female' : 'male'
  const genderToUi = (value) => value === 'female' ? 'أنثى' : 'ذكر'
  const statusToDb = (value) => value === 'معتمد' ? 'approved' : value === 'مرفوض' ? 'rejected' : 'pending'
  const statusToUi = (value) => value === 'approved' ? 'معتمد' : value === 'rejected' ? 'مرفوض' : 'قيد المراجعة'

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) loadProfile(data.session.user.id)
      else setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      if (newSession) loadProfile(newSession.user.id)
      else { setProfile(null); setLoading(false) }
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => { if (session) refreshStats() }, [session])

  async function loadProfile(userId) {
    setLoading(true)
    const { data, error: profileError } = await supabase
      .from('profiles')
      .select('*, clubs(id,name,city,logo_url)')
      .eq('id', userId)
      .single()

    if (profileError) setError(profileError.message)
    else setProfile(data)
    setLoading(false)
  }

  async function refreshStats() {
    const tables = ['clubs', 'swimmers', 'competitions', 'competition_registrations']
    const counts = await Promise.all(
      tables.map((table) => supabase.from(table).select('*', { count: 'exact', head: true }))
    )
    setStats({
      clubs: counts[0].count || 0,
      swimmers: counts[1].count || 0,
      competitions: counts[2].count || 0,
      registrations: counts[3].count || 0,
    })
  }

  async function login(email, password) {
    setError('')
    const { error: loginError } = await supabase.auth.signInWithPassword({ email, password })
    if (loginError) setError(loginError.message)
  }

  async function logout() { await supabase.auth.signOut() }

  async function loadClubs() {
    const { data, error: e } = await supabase.from('clubs').select('*').order('created_at', { ascending: false })
    if (e) setError(e.message)
    else setClubs(data || [])
  }

  async function loadSwimmers() {
    const { data, error: e } = await supabase
      .from('swimmers')
      .select('*, clubs(id,name,logo_url)')
      .order('created_at', { ascending: false })
    if (e) setError(e.message)
    else setSwimmers(data || [])
  }

  useEffect(() => {
    if (!session) return
    if (activePage === 'clubs') loadClubs()
    if (activePage === 'swimmers') { loadSwimmers(); if (!clubs.length) loadClubs() }
  }, [activePage, session])

  function openClubAdd() {
    if (!isFederationAdmin) return
    setClubForm(emptyClub)
    setClubModal('add')
    setError('')
  }

  async function saveClub(e) {
    if (!isFederationAdmin && clubModal === 'add') return setError('غير مسموح لك.')
    e.preventDefault()
    setError('')

    const payload = {
      name: clubForm.name.trim(),
      city: clubForm.city.trim(),
      phone: clubForm.phone.trim(),
      email: clubForm.email.trim(),
      logo_url: clubForm.logo_url.trim() || null
    }

    const { data: newClub, error: clubErr } = clubModal === 'add'
      ? await supabase.from('clubs').insert(payload).select().single()
      : await supabase.from('clubs').update(payload).eq('id', clubModal.id)

    if (clubErr) return setError(clubErr.message)

    // إذا كانت إضافة جديدة وتم تزويد معلومات مدير النادي
    if (clubModal === 'add' && clubForm.admin_email && clubForm.admin_password) {
      const { data: authData, error: authErr } = await supabase.auth.signUp({
        email: clubForm.admin_email,
        password: clubForm.admin_password,
        options: {
          data: {
            full_name: `${clubForm.admin_first_name} ${clubForm.admin_last_name}`,
            role: 'club_admin',
            club_id: newClub.id
          }
        }
      })
      if (authErr) setError(`تم حفظ النادي ولكن تعذر إنشاء حساب المدير: ${authErr.message}`)
    }

    setClubModal(null)
    await loadClubs()
    await refreshStats()
  }

  const filteredSwimmers = useMemo(() => {
    const q = swimmerSearch.toLowerCase().trim()
    return swimmers.filter(s => {
      const matchesClub = !swimmerClubFilter || s.club_id === swimmerClubFilter
      const matchesStatus = !swimmerStatusFilter || s.status === swimmerStatusFilter
      const matchesQuery = !q || [
        s.first_name, s.last_name, s.registration_number, s.category, s.clubs?.name
      ].some(v => (v || '').toLowerCase().includes(q))
      return matchesClub && matchesStatus && matchesQuery
    })
  }, [swimmers, swimmerSearch, swimmerClubFilter, swimmerStatusFilter])

  if (!session) return <Login onLogin={login} error={error} />

  return (
    <div className="app-shell" dir="rtl">
      <aside className="sidebar">
        <div className="brand">
          <img src="/الاتحادية.jfif" alt="شعار الاتحادية" className="brand-logo-img" />
          <div><strong>الاتحادية</strong><span>نظام إدارة السباحة</span></div>
        </div>
        <nav>
          <button className={activePage === 'dashboard' ? 'nav-item active' : 'nav-item'} onClick={() => setActivePage('dashboard')}><span>⌂</span>لوحة التحكم</button>
          <button className={activePage === 'clubs' ? 'nav-item active' : 'nav-item'} onClick={() => setActivePage('clubs')}><span>🏢</span>الأندية</button>
          <button className={activePage === 'swimmers' ? 'nav-item active' : 'nav-item'} onClick={() => setActivePage('swimmers')}><span>🏊</span>السباحون</button>
        </nav>
        <div className="sidebar-bottom">
          <button className="logout" onClick={logout}>تسجيل الخروج</button>
        </div>
      </aside>

      <main className="main">
        {error && <div className="alert">{error}<button onClick={() => setError('')}>×</button></div>}

        {activePage === 'clubs' && (
          <section>
            <div className="page-head">
              <h2>إدارة الأندية</h2>
              {isFederationAdmin && <button className="primary" onClick={openClubAdd}>＋ إضافة نادي</button>}
            </div>
            <div className="table-card">
              <table>
                <thead><tr><th>الشعار</th><th>النادي</th><th>المدينة</th><th>الهاتف</th><th>البريد</th></tr></thead>
                <tbody>
                  {clubs.map(c => (
                    <tr key={c.id}>
                      <td>{c.logo_url ? <img src={c.logo_url} className="club-logo-thumb" alt="" /> : '🏢'}</td>
                      <td><strong>{c.name}</strong></td>
                      <td>{c.city}</td>
                      <td>{c.phone}</td>
                      <td>{c.email}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activePage === 'swimmers' && (
          <section>
            <div className="page-head"><h2>قائمة السباحين</h2></div>
            <div className="table-card">
              <table>
                <thead><tr><th>الصورة</th><th>الاسم واللقب</th><th>رقم التسجيل</th><th>الفئة</th><th>النادي</th><th>بطاقة السباح</th></tr></thead>
                <tbody>
                  {filteredSwimmers.map(s => (
                    <tr key={s.id}>
                      <td><img src={s.photo_url || '/default-avatar.png'} className="swimmer-thumb" alt="" /></td>
                      <td><strong>{s.first_name} {s.last_name}</strong></td>
                      <td>{s.registration_number || '—'}</td>
                      <td>{s.category}</td>
                      <td>{s.clubs?.name || 'بدون نادي'}</td>
                      <td>
                        <button className="small secondary" onClick={() => setCardSwimmer(s)}>📇 عرض البطاقة</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>

      {/* نافذة إضافة نادي مع بيانات المدير */}
      {clubModal && (
        <Modal title="إضافة نادي جديد ومعلومات المدير" onClose={() => setClubModal(null)}>
          <form onSubmit={saveClub} className="form-grid two">
            <h4 className="wide">معلومات النادي</h4>
            <label>اسم النادي *<input required value={clubForm.name} onChange={e => setClubForm({...clubForm, name: e.target.value})} /></label>
            <label>المدينة<input value={clubForm.city} onChange={e => setClubForm({...clubForm, city: e.target.value})} /></label>
            <label>الهاتف<input value={clubForm.phone} onChange={e => setClubForm({...clubForm, phone: e.target.value})} /></label>
            <label>رابط الشعار Logo<input value={clubForm.logo_url} onChange={e => setClubForm({...clubForm, logo_url: e.target.value})} /></label>

            <h4 className="wide" style={{marginTop: '1rem', borderTop: '1px solid #ddd', paddingTop: '0.5rem'}}>معلومات مدير النادي (الحساب)</h4>
            <label>الاسم<input value={clubForm.admin_first_name} onChange={e => setClubForm({...clubForm, admin_first_name: e.target.value})} /></label>
            <label>اللقب<input value={clubForm.admin_last_name} onChange={e => setClubForm({...clubForm, admin_last_name: e.target.value})} /></label>
            <label>البريد الإلكتروني *<input type="email" value={clubForm.admin_email} onChange={e => setClubForm({...clubForm, admin_email: e.target.value})} /></label>
            <label>كلمة المرور *<input type="password" value={clubForm.admin_password} onChange={e => setClubForm({...clubForm, admin_password: e.target.value})} /></label>

            <div className="form-actions wide">
              <button type="button" onClick={() => setClubModal(null)}>إلغاء</button>
              <button className="primary">حفظ النادي والمدير</button>
            </div>
          </form>
        </Modal>
      )}

      {/* نافذة معاينة وطباعة بطاقة السباح */}
      {cardSwimmer && (
        <Modal title="بطاقة السباح الرسمية" onClose={() => setCardSwimmer(null)}>
          <div className="print-area">
            <div className="swimmer-card">
              <div className="card-header">
                <img src="/الاتحادية.jfif" alt="الاتحادية" className="card-federation-logo" />
                <div className="card-header-text">
                  <h3>الاتحادية الجزائرية للسباحة</h3>
                  <span>بطاقة رياضي معتمد</span>
                </div>
                {cardSwimmer.clubs?.logo_url && (
                  <img src={cardSwimmer.clubs.logo_url} alt="النادي" className="card-club-logo" />
                )}
              </div>
              <div className="card-body">
                <div className="card-photo">
                  <img src={cardSwimmer.photo_url || '/default-avatar.png'} alt="السباح" />
                </div>
                <div className="card-details">
                  <p><strong>الاسم:</strong> {cardSwimmer.first_name}</p>
                  <p><strong>اللقب:</strong> {cardSwimmer.last_name}</p>
                  <p><strong>رقم التسجيل:</strong> {cardSwimmer.registration_number || 'غير مسجل'}</p>
                  <p><strong>الفئة:</strong> {cardSwimmer.category}</p>
                  <p><strong>النادي:</strong> {cardSwimmer.clubs?.name || 'بدون نادي'}</p>
                  <p><strong>تاريخ الميلاد:</strong> {cardSwimmer.birth_date || '—'}</p>
                </div>
              </div>
            </div>
          </div>
          <div className="form-actions" style={{marginTop: '1.5rem'}}>
            <button className="primary" onClick={() => window.print()}>🖨️ طباعة البطاقة</button>
            <button type="button" onClick={() => setCardSwimmer(null)}>إغلاق</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Modal({ title, children, onClose }) {
  return <div className="modal-backdrop"><div className="modal"><div className="modal-head"><h2>{title}</h2><button onClick={onClose}>×</button></div>{children}</div></div>
}

function Login({ onLogin, error }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  return (
    <div className="login-page" dir="rtl">
      <form className="login-card" onSubmit={e => { e.preventDefault(); onLogin(email, password) }}>
        <img src="/الاتحادية.jfif" alt="الاتحادية" className="login-logo" />
        <h1>نظام إدارة السباحة</h1>
        {error && <div className="alert">{error}</div>}
        <label>البريد الإلكتروني<input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label>كلمة المرور<input type="password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
        <button className="primary full">دخول</button>
      </form>
    </div>
  )
}

export default App