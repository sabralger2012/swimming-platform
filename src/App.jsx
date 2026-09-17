import { useEffect, useMemo, useState, useRef } from 'react'
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
  const [cardSwimmer, setCardSwimmer] = useState(null)
  const [clubForm, setClubForm] = useState(emptyClub)
  const [swimmerForm, setSwimmerForm] = useState(emptySwimmer)
  const [swimmerFile, setSwimmerFile] = useState(null)
  const [swimmerPhotoFile, setSwimmerPhotoFile] = useState(null)
  const [competitionModal, setCompetitionModal] = useState(null)
  const [competitionForm, setCompetitionForm] = useState({ name: '', competition_date: '', location: '' })
  const [registrations, setRegistrations] = useState([])
  const [registrationSearch, setRegistrationSearch] = useState('')
  const [selectedCompetitionFilter, setSelectedCompetitionFilter] = useState('')
  const [registrationModal, setRegistrationModal] = useState(null)
  const [registrationForm, setRegistrationForm] = useState({ competition_id: '', swimmer_id: '', race: '', seed_time: '' })
  const [error, setError] = useState('')
  const [users, setUsers] = useState([])
  const [userSearch, setUserSearch] = useState('')
  const [userModal, setUserModal] = useState(null)
  const [userForm, setUserForm] = useState({ full_name: '', role: 'club_admin', club_id: '' })
  const suppressAuthEvents = useRef(false)

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
      if (suppressAuthEvents.current) return
      setSession(newSession)
      if (newSession) loadProfile(newSession.user.id)
      else {
        setProfile(null)
        setLoading(false)
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session) refreshStats()
  }, [session])

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

  async function loadUsers() {
    if (!isFederationAdmin) return
    const { data, error: e } = await supabase
      .from('profiles')
      .select('id,full_name,email,role,club_id,created_at,clubs(id,name)')
      .order('created_at', { ascending: false })
    if (e) setError(e.message)
    else setUsers(data || [])
  }

  function openUserEdit(user) {
    if (!isFederationAdmin) return
    setUserForm({
      full_name: user.full_name || '',
      role: user.role || 'club_admin',
      club_id: user.club_id || '',
    })
    setUserModal(user)
    setError('')
    if (!clubs.length) loadClubs()
  }

  async function saveUser(e) {
    e.preventDefault()
    if (!isFederationAdmin) return
    setError('')

    if (!userForm.full_name.trim()) return setError('اسم المستخدم مطلوب.')
    if (userForm.role === 'club_admin' && !userForm.club_id) {
      return setError('يجب اختيار النادي لمدير النادي.')
    }

    const payload = {
      full_name: userForm.full_name.trim(),
      role: userForm.role,
      club_id: userForm.role === 'club_admin' ? userForm.club_id : null,
      updated_at: new Date().toISOString(),
    }

    const { error: updateError } = await supabase
      .from('profiles')
      .update(payload)
      .eq('id', userModal.id)

    if (updateError) return setError(updateError.message)
    setUserModal(null)
    await loadUsers()
    if (userModal.id === profile?.id) await loadProfile(profile.id)
  }

  const filteredUsers = useMemo(() => {
    const q = userSearch.toLowerCase().trim()
    return users.filter(u => [
      u.full_name, u.email, u.role, u.clubs?.name
    ].some(v => (v || '').toLowerCase().includes(q)))
  }, [users, userSearch])

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

  async function logout() {
    await supabase.auth.signOut()
  }

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
    if (activePage === 'swimmers') {
      loadSwimmers()
      if (!clubs.length) loadClubs()
    }
    if (activePage === 'competitions') loadCompetitions()
    if (activePage === 'users' && isFederationAdmin) {
      loadUsers()
      if (!clubs.length) loadClubs()
    }
    if (activePage === 'registrations') {
      loadCompetitions()
      loadSwimmers()
      loadRegistrations()
    }
  }, [activePage, session])

  function openClubAdd() {
    if (!isFederationAdmin) return
    setClubForm(emptyClub)
    setClubModal('add')
    setError('')
  }

  function openClubEdit(club) {
    setClubForm({
      name: club.name || '',
      city: club.city || '',
      phone: club.phone || '',
      email: club.email || '',
      logo_url: club.logo_url || '',
      admin_first_name: '',
      admin_last_name: '',
      admin_email: '',
      admin_password: ''
    })
    setClubModal(club)
    setError('')
  }

  async function saveClub(e) {
    if (!isFederationAdmin && clubModal === 'add') return setError('مدير النادي لا يمكنه إضافة نادٍ.')
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

    if (clubModal === 'add' && clubForm.admin_email && clubForm.admin_password) {
      // مهم: supabase.auth.signUp() يستبدل جلسة الدخول الحالية بجلسة الحساب الجديد.
      // نحفظ جلسة مدير الاتحادية أولاً حتى نعيدها بعد إنشاء حساب مدير النادي،
      // فلا يتم تسجيل خروج المدير الحالي أو إدخاله بحساب النادي الجديد.
      const { data: currentSessionData } = await supabase.auth.getSession()
      const adminSession = currentSessionData?.session

      suppressAuthEvents.current = true
      try {
        const { error: authErr } = await supabase.auth.signUp({
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

        if (adminSession) {
          await supabase.auth.setSession({
            access_token: adminSession.access_token,
            refresh_token: adminSession.refresh_token,
          })
        }
      } finally {
        suppressAuthEvents.current = false
      }
    }

    setClubModal(null)
    await loadClubs()
    await refreshStats()
  }

  async function deleteClub(id) {
    if (!isFederationAdmin) return
    if (!confirm('هل أنت متأكد من حذف هذا النادي؟')) return
    const { error: e } = await supabase.from('clubs').delete().eq('id', id)
    if (e) setError(e.message)
    else {
      await loadClubs()
      await refreshStats()
    }
  }

  function openSwimmerAdd() {
    setSwimmerForm({ ...emptySwimmer, club_id: isClubAdmin ? (profile?.club_id || '') : '' })
    setSwimmerFile(null)
    setSwimmerPhotoFile(null)
    setSwimmerModal('add')
    setError('')
    if (!clubs.length) loadClubs()
  }

  function openSwimmerEdit(swimmer) {
    setSwimmerForm({
      registration_number: swimmer.registration_number || '',
      first_name: swimmer.first_name || '',
      last_name: swimmer.last_name || '',
      birth_date: swimmer.birth_date || '',
      birth_place: swimmer.birth_place || '',
      gender: genderToUi(swimmer.gender),
      phone: swimmer.phone || '',
      category: swimmer.category || '',
      club_id: swimmer.club_id || '',
      status: statusToUi(swimmer.status),
      photo_url: swimmer.photo_url || '',
      document_url: swimmer.document_url || '',
    })
    setSwimmerFile(null)
    setSwimmerPhotoFile(null)
    setSwimmerModal(swimmer)
    setError('')
    if (!clubs.length) loadClubs()
  }

  async function updateSwimmerStatus(swimmerId, newStatus) {
    const { error: e } = await supabase
      .from('swimmers')
      .update({ status: newStatus })
      .eq('id', swimmerId)

    if (e) setError(e.message)
    else await loadSwimmers()
  }

  async function saveSwimmer(e) {
    e.preventDefault()
    setError('')
    if (!swimmerForm.first_name.trim() || !swimmerForm.last_name.trim() || !swimmerForm.category.trim()) {
      return setError('الاسم واللقب والفئة حقول مطلوبة.')
    }

    let uploadedPhotoUrl = swimmerForm.photo_url

    if (swimmerPhotoFile) {
      const photoExt = swimmerPhotoFile.name.split('.').pop()
      const photoFileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${photoExt}`
      const { error: photoUploadError } = await supabase.storage
        .from('swimmer-photos')
        .upload(photoFileName, swimmerPhotoFile)

      if (photoUploadError) return setError(`فشل رفع الصورة: ${photoUploadError.message}`)

      const { data: photoUrlData } = supabase.storage
        .from('swimmer-photos')
        .getPublicUrl(photoFileName)

      uploadedPhotoUrl = photoUrlData.publicUrl
    }

    let uploadedDocUrl = swimmerForm.document_url

    if (swimmerFile) {
      const fileExt = swimmerFile.name.split('.').pop()
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('documents')
        .upload(fileName, swimmerFile)

      if (uploadError) return setError(`فشل رفع الوثيقة: ${uploadError.message}`)
      
      const { data: publicUrlData } = supabase.storage
        .from('documents')
        .getPublicUrl(fileName)

      uploadedDocUrl = publicUrlData.publicUrl
    }

    const payload = {
      registration_number: swimmerForm.registration_number.trim() || null,
      first_name: swimmerForm.first_name.trim(),
      last_name: swimmerForm.last_name.trim(),
      birth_date: swimmerForm.birth_date || null,
      birth_place: swimmerForm.birth_place.trim() || null,
      gender: genderToDb(swimmerForm.gender),
      phone: swimmerForm.phone.trim() || null,
      category: swimmerForm.category.trim(),
      club_id: isClubAdmin ? (profile?.club_id || null) : (swimmerForm.club_id || null),
      status: statusToDb(swimmerForm.status),
      photo_url: uploadedPhotoUrl || null,
      document_url: uploadedDocUrl || null,
    }

    const result = swimmerModal === 'add'
      ? await supabase.from('swimmers').insert(payload)
      : await supabase.from('swimmers').update(payload).eq('id', swimmerModal.id)

    if (result.error) return setError(result.error.message)
    setSwimmerModal(null)
    await loadSwimmers()
    await refreshStats()
  }

  async function deleteSwimmer(id) {
    if (!confirm('هل أنت متأكد من حذف هذا السباح؟')) return
    const { error: e } = await supabase.from('swimmers').delete().eq('id', id)
    if (e) setError(e.message)
    else {
      await loadSwimmers()
      await refreshStats()
    }
  }

  function exportSwimmersToExcel() {
    const dataToExport = filteredSwimmers.map(s => ({
      'رقم التسجيل': s.registration_number || '—',
      'الاسم': s.first_name,
      'اللقب': s.last_name,
      'الجنس': s.gender === 'female' ? 'أنثى' : 'ذكر',
      'تاريخ الميلاد': s.birth_date || '—',
      'مكان الميلاد': s.birth_place || '—',
      'الفئة': s.category,
      'النادي': s.clubs?.name || 'بدون نادي',
      'الحالة': statusToUi(s.status),
      'الهاتف': s.phone || '—',
    }))

    const worksheet = XLSX.utils.json_to_sheet(dataToExport)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, "السباحون")
    XLSX.writeFile(workbook, `قائمة_السباحين_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  async function loadCompetitions() {
    const { data, error: e } = await supabase
      .from('competitions')
      .select('*')
      .order('competition_date', { ascending: true, nullsFirst: false })
    if (e) setError(e.message)
    else setCompetitions(data || [])
  }

  function openCompetitionAdd() {
    if (!isFederationAdmin) return
    setCompetitionForm({ name: '', competition_date: '', location: '' })
    setCompetitionModal('add')
    setError('')
  }

  function openCompetitionEdit(competition) {
    if (!isFederationAdmin) return
    setCompetitionForm({
      name: competition.name || '',
      competition_date: competition.competition_date || '',
      location: competition.location || '',
    })
    setCompetitionModal(competition)
    setError('')
  }

  async function saveCompetition(e) {
    e.preventDefault()
    setError('')
    if (!competitionForm.name.trim()) return setError('اسم المنافسة مطلوب.')

    const payload = {
      name: competitionForm.name.trim(),
      competition_date: competitionForm.competition_date || null,
      location: competitionForm.location.trim() || null,
    }

    const result = competitionModal === 'add'
      ? await supabase.from('competitions').insert(payload)
      : await supabase.from('competitions').update(payload).eq('id', competitionModal.id)

    if (result.error) return setError(result.error.message)
    setCompetitionModal(null)
    await loadCompetitions()
    await refreshStats()
  }

  async function deleteCompetition(id) {
    if (!isFederationAdmin) return
    if (!confirm('هل أنت متأكد من حذف هذه المنافسة؟')) return
    const { error: e } = await supabase.from('competitions').delete().eq('id', id)
    if (e) setError(e.message)
    else {
      await loadCompetitions()
      await refreshStats()
    }
  }

  async function loadRegistrations() {
    const { data, error: e } = await supabase
      .from('competition_registrations')
      .select(`
        *,
        competitions(id,name,competition_date),
        swimmers(id,first_name,last_name,registration_number,category,clubs(name))
      `)
      .order('created_at', { ascending: false })
    if (e) setError(e.message)
    else setRegistrations(data || [])
  }

  function openRegistrationAdd() {
    setRegistrationForm({
      competition_id: competitions[0]?.id || '',
      swimmer_id: swimmers[0]?.id || '',
      race: '',
      seed_time: '',
    })
    setRegistrationModal('add')
    setError('')
    if (!competitions.length) loadCompetitions()
    if (!swimmers.length) loadSwimmers()
  }

  function openRegistrationEdit(registration) {
    setRegistrationForm({
      competition_id: registration.competition_id || '',
      swimmer_id: registration.swimmer_id || '',
      race: registration.race || '',
      seed_time: registration.seed_time || '',
    })
    setRegistrationModal(registration)
    setError('')
    if (!competitions.length) loadCompetitions()
    if (!swimmers.length) loadSwimmers()
  }

  async function saveRegistration(e) {
    e.preventDefault()
    setError('')
    if (!registrationForm.competition_id || !registrationForm.swimmer_id) {
      return setError('يجب اختيار المنافسة والسباح.')
    }

    const payload = {
      competition_id: registrationForm.competition_id,
      swimmer_id: registrationForm.swimmer_id,
      race: registrationForm.race.trim() || null,
      seed_time: registrationForm.seed_time.trim() || null,
    }

    const result = registrationModal === 'add'
      ? await supabase.from('competition_registrations').insert(payload)
      : await supabase.from('competition_registrations').update(payload).eq('id', registrationModal.id)

    if (result.error) return setError(result.error.message)
    setRegistrationModal(null)
    await loadRegistrations()
    await refreshStats()
  }

  async function deleteRegistration(id) {
    if (!confirm('هل أنت متأكد من حذف هذا التسجيل؟')) return
    const { error: e } = await supabase.from('competition_registrations').delete().eq('id', id)
    if (e) setError(e.message)
    else {
      await loadRegistrations()
      await refreshStats()
    }
  }

  const filteredRegistrations = useMemo(() => {
    const q = registrationSearch.toLowerCase().trim()
    return registrations.filter(r => {
      const matchesCompFilter = !selectedCompetitionFilter || r.competition_id === selectedCompetitionFilter
      const swimmer = r.swimmers
      const competition = r.competitions
      const values = [
        swimmer?.first_name, swimmer?.last_name, swimmer?.registration_number,
        swimmer?.category, swimmer?.clubs?.name, competition?.name, r.race, r.seed_time
      ]
      const matchesQuery = !q || values.some(v => (v || '').toLowerCase().includes(q))
      return matchesCompFilter && matchesQuery
    })
  }, [registrations, registrationSearch, selectedCompetitionFilter])

  const filteredClubs = useMemo(() => {
    const q = clubSearch.toLowerCase().trim()
    return clubs.filter(c => !q || [c.name, c.city, c.phone, c.email].some(v => (v || '').toLowerCase().includes(q)))
  }, [clubs, clubSearch])

  const filteredCompetitions = useMemo(() => {
    const q = competitionSearch.toLowerCase().trim()
    return competitions.filter(c => !q || [c.name, c.location, c.competition_date]
      .some(v => (v || '').toLowerCase().includes(q)))
  }, [competitions, competitionSearch])

  const filteredSwimmers = useMemo(() => {
    const q = swimmerSearch.toLowerCase().trim()
    return swimmers.filter(s => {
      const matchesClub = !swimmerClubFilter || s.club_id === swimmerClubFilter
      const matchesStatus = !swimmerStatusFilter || s.status === swimmerStatusFilter
      const matchesQuery = !q || [
        s.first_name, s.last_name, s.registration_number, s.category, s.gender, s.clubs?.name
      ].some(v => (v || '').toLowerCase().includes(q))
      return matchesClub && matchesStatus && matchesQuery
    })
  }, [swimmers, swimmerSearch, swimmerClubFilter, swimmerStatusFilter])

  if (!session) return <Login onLogin={login} error={error} />

  const nav = [
    ['dashboard', 'لوحة التحكم', 'home'],
    ['clubs', 'الأندية', 'building'],
    ['swimmers', 'السباحون', 'swimmer'],
    ['competitions', 'المنافسات', 'trophy'],
    ['registrations', 'التسجيلات', 'clipboard'],
    ...(isFederationAdmin ? [['users', 'المستخدمون', 'users'], ['documents', 'الوثائق', 'folder']] : []),
  ]

  return (
    <div className="app-shell" dir="rtl">
      <aside className="sidebar">
        <div className="brand">
          <img src="/الاتحادية.jfif" alt="شعار الاتحادية" className="brand-logo-img" />
          <div><strong>الاتحادية</strong><span>نظام إدارة السباحة</span></div>
        </div>
        <nav>
          {nav.map(([key, label, icon]) => (
            <button key={key} className={activePage === key ? 'nav-item active' : 'nav-item'} onClick={() => { setActivePage(key); setError('') }}>
              <Icon name={icon} className="nav-icon" />{label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="user-mini">
            <div className="avatar">{(profile?.full_name || profile?.email || 'م').slice(0, 1)}</div>
            <div><strong>{profile?.full_name || 'المستخدم'}</strong><span>{isFederationAdmin ? 'مدير الرابطة' : 'مدير نادي'}</span></div>
          </div>
          <button className="logout" onClick={logout}>تسجيل الخروج</button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div><h1>{nav.find(x => x[0] === activePage)?.[1]}</h1><p>إدارة نظام السباحة</p></div>
          <div className="top-user">{profile?.email}</div>
        </header>

        {error && <div className="alert">{error}<button onClick={() => setError('')}>×</button></div>}

        {activePage === 'dashboard' && (
          <Dashboard stats={stats} onNavigate={setActivePage} isFederationAdmin={isFederationAdmin} clubName={profile?.clubs?.name} />
        )}

        {activePage === 'clubs' && (
          <section>
            <PageHead title={isFederationAdmin ? 'إدارة الأندية' : 'ناديي'} button={isFederationAdmin ? 'إضافة نادي' : null} onAdd={isFederationAdmin ? openClubAdd : undefined} count={filteredClubs.length} />
            <div className="toolbar"><input placeholder="ابحث عن نادي..." value={clubSearch} onChange={e => setClubSearch(e.target.value)} /></div>
            <div className="table-card">
              <table><thead><tr><th>الشعار</th><th>النادي</th><th>المدينة</th><th>الهاتف</th><th>البريد</th><th>الإجراءات</th></tr></thead>
              <tbody>
                {filteredClubs.map(c => <tr key={c.id}>
                  <td>
                    {c.logo_url ? <img src={c.logo_url} alt={c.name} className="club-logo-thumb" /> : <div className="club-logo-placeholder">🏢</div>}
                  </td>
                  <td><strong>{c.name}</strong></td><td>{c.city || '—'}</td><td>{c.phone || '—'}</td><td>{c.email || '—'}</td><td><button className="small" onClick={() => openClubEdit(c)}>تعديل</button>{isFederationAdmin && <button className="small danger" onClick={() => deleteClub(c.id)}>حذف</button>}</td></tr>)}
                {!filteredClubs.length && <tr><td colSpan="6" className="empty">لا توجد أندية.</td></tr>}
              </tbody></table>
            </div>
          </section>
        )}

        {activePage === 'swimmers' && (
          <section>
            <PageHead title="إدارة السباحين" button="إضافة سباح" onAdd={openSwimmerAdd} count={filteredSwimmers.length} />
            <div className="toolbar flex-gap">
              <input placeholder="ابحث بالاسم أو رقم التسجيل..." value={swimmerSearch} onChange={e => setSwimmerSearch(e.target.value)} />
              {isFederationAdmin && (
                <select value={swimmerClubFilter} onChange={e => setSwimmerClubFilter(e.target.value)}>
                  <option value="">جميع الأندية</option>
                  {clubs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
              <select value={swimmerStatusFilter} onChange={e => setSwimmerStatusFilter(e.target.value)}>
                <option value="">جميع الحالات</option>
                <option value="approved">معتمد</option>
                <option value="pending">قيد المراجعة</option>
                <option value="rejected">مرفوض</option>
              </select>
              <button className="secondary" onClick={exportSwimmersToExcel}>📊 تصدير Excel</button>
            </div>
            <div className="table-card">
              <table><thead><tr><th>الصورة</th><th>الاسم واللقب</th><th>رقم التسجيل</th><th>الجنس</th><th>الفئة</th><th>النادي</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
              <tbody>
                {filteredSwimmers.map(s => <tr key={s.id}>
                  <td><img src={s.photo_url || '/default-avatar.png'} className="swimmer-thumb" alt="" /></td>
                  <td><strong>{s.first_name} {s.last_name}</strong></td>
                  <td>{s.registration_number || '—'}</td>
                  <td>{s.gender === 'male' ? 'ذكر' : s.gender === 'female' ? 'أنثى' : '—'}</td>
                  <td>{s.category}</td>
                  <td>
                    {s.clubs?.logo_url && <img src={s.clubs.logo_url} alt="" className="club-logo-mini" />}
                    {s.clubs?.name || 'بدون نادي'}
                  </td>
                  <td><span className={`status status-${s.status}`}>{statusToUi(s.status)}</span></td>
                  <td>
                    <button className="small secondary" onClick={() => setCardSwimmer(s)}>📇 بطاقة</button>
                    <button className="small" onClick={() => openSwimmerEdit(s)}>تعديل</button>
                    {isFederationAdmin && s.status === 'pending' && (
                      <button className="small success" onClick={() => updateSwimmerStatus(s.id, 'approved')}>اعتماد</button>
                    )}
                    <button className="small danger" onClick={() => deleteSwimmer(s.id)}>حذف</button>
                  </td>
                </tr>)}
                {!filteredSwimmers.length && <tr><td colSpan="8" className="empty">لا توجد بيانات للسباحين.</td></tr>}
              </tbody></table>
            </div>
          </section>
        )}

        {activePage === 'competitions' && (
          <CompetitionsPage
            competitions={competitions}
            search={competitionSearch}
            setSearch={setCompetitionSearch}
            onAdd={openCompetitionAdd}
            onEdit={openCompetitionEdit}
            onDelete={deleteCompetition}
            canManage={isFederationAdmin}
          />
        )}

        {activePage === 'registrations' && (
          <RegistrationsPage
            registrations={filteredRegistrations}
            search={registrationSearch}
            setSearch={setRegistrationSearch}
            competitions={competitions}
            selectedCompetition={selectedCompetitionFilter}
            setSelectedCompetition={setSelectedCompetitionFilter}
            onAdd={openRegistrationAdd}
            onEdit={openRegistrationEdit}
            onDelete={deleteRegistration}
          />
        )}

        {activePage === 'users' && isFederationAdmin && (
          <UsersPage
            users={filteredUsers}
            search={userSearch}
            setSearch={setUserSearch}
            onEdit={openUserEdit}
          />
        )}

        {activePage === 'documents' && isFederationAdmin && (
          <DocumentsPage />
        )}

        {competitionModal && (
          <CompetitionModal
            form={competitionForm}
            setForm={setCompetitionForm}
            onClose={() => setCompetitionModal(null)}
            onSave={saveCompetition}
            editing={competitionModal !== 'add'}
            error={error}
          />
        )}
      </main>

      {clubModal && <ClubModal form={clubForm} setForm={setClubForm} onClose={() => setClubModal(null)} onSave={saveClub} editing={clubModal !== 'add'} error={error} />}
      {swimmerModal && <SwimmerModal form={swimmerForm} setForm={setSwimmerForm} setFile={setSwimmerFile} photoFile={swimmerPhotoFile} setPhotoFile={setSwimmerPhotoFile} clubs={clubs} isClubAdmin={isClubAdmin} onClose={() => setSwimmerModal(null)} onSave={saveSwimmer} editing={swimmerModal !== 'add'} error={error} />}
      {registrationModal && <RegistrationModal form={registrationForm} setForm={setRegistrationForm} competitions={competitions} swimmers={swimmers} onClose={() => setRegistrationModal(null)} onSave={saveRegistration} editing={registrationModal !== 'add'} error={error} />}
      {userModal && <UserModal form={userForm} setForm={setUserForm} clubs={clubs} onClose={() => setUserModal(null)} onSave={saveUser} error={error} />}

      {/* نافذة بطاقة السباح للطباعة */}
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

function DocumentsPage() {
  return (
    <section>
      <PageHead title="مركز الوثائق والنشرات" button="رفع وثيقة جديدة" onAdd={() => alert('يمكنك رفع ونشر القوانين والجداول الرسمية هنا.')} />
      <div className="table-card">
        <table>
          <thead><tr><th>عنوان الوثيقة</th><th>النوع</th><th>تاريخ الرفع</th><th>الإجراءات</th></tr></thead>
          <tbody>
            <tr>
              <td><strong>القانون الأساسي للمنافسات 2026</strong></td>
              <td><span className="status">PDF</span></td>
              <td>10 سبتمبر 2026</td>
              <td><button className="small">تحميل</button></td>
            </tr>
            <tr>
              <td><strong>جدول التوقيتات التأهيلية</strong></td>
              <td><span className="status">Excel</span></td>
              <td>01 سبتمبر 2026</td>
              <td><button className="small">تحميل</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

function UsersPage({ users, search, setSearch, onEdit }) {
  const roleLabel = (role) => role === 'federation_admin' ? 'مدير الاتحادية' : 'مدير نادي'

  return <section>
    <PageHead title="إدارة المستخدمين" button={null} onAdd={undefined} count={users.length} />
    <div className="toolbar">
      <input
        placeholder="ابحث بالاسم أو البريد أو النادي..."
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
    </div>
    <div className="table-card">
      <table>
        <thead><tr><th>المستخدم</th><th>البريد الإلكتروني</th><th>الدور</th><th>النادي</th><th>الإجراءات</th></tr></thead>
        <tbody>
          {users.map(u => <tr key={u.id}>
            <td><strong>{u.full_name || 'بدون اسم'}</strong></td>
            <td>{u.email || '—'}</td>
            <td><span className="status">{roleLabel(u.role)}</span></td>
            <td>{u.clubs?.name || (u.role === 'federation_admin' ? 'الاتحادية' : 'بدون نادي')}</td>
            <td><button className="small" onClick={() => onEdit(u)}>تعديل الصلاحيات</button></td>
          </tr>)}
          {!users.length && <tr><td colSpan="5" className="empty">لا توجد حسابات مستخدمين.</td></tr>}
        </tbody>
      </table>
    </div>
  </section>
}

function UserModal({ form, setForm, clubs, onClose, onSave, error }) {
  const update = (key, value) => setForm({ ...form, [key]: value })

  return <Modal title="تعديل المستخدم والصلاحيات" onClose={onClose}>
    {error && <div className="alert">{error}</div>}
    <form onSubmit={onSave} className="form-grid">
      <label>الاسم الكامل *
        <input required value={form.full_name} onChange={e => update('full_name', e.target.value)} />
      </label>
      <label>الدور *
        <select value={form.role} onChange={e => update('role', e.target.value)}>
          <option value="federation_admin">مدير الاتحادية</option>
          <option value="club_admin">مدير نادي</option>
        </select>
      </label>
      <label className="wide">النادي المرتبط
        <select
          disabled={form.role === 'federation_admin'}
          value={form.role === 'federation_admin' ? '' : form.club_id}
          onChange={e => update('club_id', e.target.value)}
        >
          <option value="">اختر النادي</option>
          {clubs.map(c => <option key={c.id} value={c.id}>{c.name}{c.city ? ` — ${c.city}` : ''}</option>)}
        </select>
      </label>
      <div className="form-actions wide">
        <button type="button" onClick={onClose}>إلغاء</button>
        <button className="primary">حفظ الصلاحيات</button>
      </div>
    </form>
  </Modal>
}

function RegistrationsPage({ registrations, search, setSearch, competitions, selectedCompetition, setSelectedCompetition, onAdd, onEdit, onDelete }) {
  const formatDate = (value) => {
    if (!value) return '—'
    return new Date(`${value}T00:00:00`).toLocaleDateString('ar-DZ', {
      year: 'numeric', month: 'long', day: 'numeric'
    })
  }

  return <section>
    <PageHead title="تسجيلات المنافسات" button="تسجيل سباح" onAdd={onAdd} count={registrations.length} />
    <div className="toolbar flex-gap">
      <input
        placeholder="ابحث بالسباح أو السباق..."
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      <select value={selectedCompetition} onChange={e => setSelectedCompetition(e.target.value)}>
        <option value="">جميع المنافسات</option>
        {competitions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <button className="secondary" onClick={() => window.print()}>🖨️ طباعة القائمة</button>
    </div>
    <div className="table-card">
      <table>
        <thead><tr><th>السباح</th><th>النادي</th><th>المنافسة</th><th>التاريخ</th><th>السباق</th><th>التوقيت المبدئي</th><th>الإجراءات</th></tr></thead>
        <tbody>
          {registrations.map(r => (
            <tr key={r.id}>
              <td><strong>{r.swimmers?.first_name} {r.swimmers?.last_name}</strong><br /><small>{r.swimmers?.registration_number || 'بدون رقم'}</small></td>
              <td>{r.swimmers?.clubs?.name || 'بدون نادي'}</td>
              <td>{r.competitions?.name || '—'}</td>
              <td>{formatDate(r.competitions?.competition_date)}</td>
              <td>{r.race || '—'}</td>
              <td>{r.seed_time || '—'}</td>
              <td>
                <button className="small" onClick={() => onEdit(r)}>تعديل</button>
                <button className="small danger" onClick={() => onDelete(r.id)}>حذف</button>
              </td>
            </tr>
          ))}
          {!registrations.length && <tr><td colSpan="7" className="empty">لا توجد تسجيلات.</td></tr>}
        </tbody>
      </table>
    </div>
  </section>
}

function RegistrationModal({ form, setForm, competitions, swimmers, onClose, onSave, editing, error }) {
  const update = (key, value) => setForm({ ...form, [key]: value })
  return <Modal title={editing ? 'تعديل تسجيل السباح' : 'تسجيل سباح في منافسة'} onClose={onClose}>
    {error && <div className="alert">{error}</div>}
    <form onSubmit={onSave} className="form-grid two">
      <label>المنافسة *
        <select required value={form.competition_id} onChange={e => update('competition_id', e.target.value)}>
          <option value="">اختر المنافسة</option>
          {competitions.map(c => <option key={c.id} value={c.id}>{c.name}{c.competition_date ? ` — ${c.competition_date}` : ''}</option>)}
        </select>
      </label>
      <label>السباح *
        <select required value={form.swimmer_id} onChange={e => update('swimmer_id', e.target.value)}>
          <option value="">اختر السباح</option>
          {swimmers.map(s => <option key={s.id} value={s.id}>{s.first_name} {s.last_name}{s.registration_number ? ` — ${s.registration_number}` : ''}</option>)}
        </select>
      </label>
      <label>السباق
        <input placeholder="مثال: 100م حرة" value={form.race} onChange={e => update('race', e.target.value)} />
      </label>
      <label>التوقيت المبدئي
        <input placeholder="مثال: 01:05.20" value={form.seed_time} onChange={e => update('seed_time', e.target.value)} />
      </label>
      <div className="form-actions wide">
        <button type="button" onClick={onClose}>إلغاء</button>
        <button className="primary">{editing ? 'حفظ التعديلات' : 'حفظ التسجيل'}</button>
      </div>
    </form>
  </Modal>
}

function Login({ onLogin, error }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  return <div className="login-page" dir="rtl">
    <form className="login-card" onSubmit={e => { e.preventDefault(); onLogin(email, password) }}>
      <img src="/الاتحادية.jfif" alt="الاتحادية" className="login-logo" />
      <h1>نظام إدارة السباحة</h1><p>تسجيل الدخول إلى لوحة الإدارة</p>
      {error && <div className="alert">{error}</div>}
      <label>البريد الإلكتروني<input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label>كلمة المرور<input type="password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
      <button className="primary full">دخول</button>
    </form>
  </div>
}

function Dashboard({ stats, onNavigate, isFederationAdmin, clubName }) {
  return <section>
    <div className="welcome"><div><h2>مرحبًا بك 👋</h2><p>{isFederationAdmin ? 'من هنا يمكنك إدارة كامل نظام السباحة.' : `إدارة نادي ${clubName || 'ناديك'} والسباحين والتسجيلات.`}</p></div><div className="welcome-icon"><Icon name="swimmer" /></div></div>
    <div className="stats-grid">
      <Stat label="الأندية" value={stats.clubs} icon="building" />
      <Stat label="السباحون" value={stats.swimmers} icon="swimmer" />
      <Stat label="المنافسات" value={stats.competitions} icon="trophy" />
      <Stat label="التسجيلات" value={stats.registrations} icon="clipboard" />
    </div>
    <h2 className="section-title">الوصول السريع</h2>
    <div className="quick-grid">
      <Quick title="إدارة الأندية" icon="building" onClick={() => onNavigate('clubs')} />
      <Quick title="إدارة السباحين" icon="swimmer" onClick={() => onNavigate('swimmers')} />
      <Quick title="المنافسات" icon="trophy" onClick={() => onNavigate('competitions')} />
      <Quick title="التسجيلات" icon="clipboard" onClick={() => onNavigate('registrations')} />
    </div>
  </section>
}

function Icon({ name, className = '' }) {
  const paths = {
    home: <path d="M3 9.5 12 3l9 6.5M5 10v9a1 1 0 0 0 1 1h3v-6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6h3a1 1 0 0 0 1-1v-9" />,
    building: <>
      <path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17" />
      <path d="M3 21h18M10 21v-3h4v3M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1" />
    </>,
    swimmer: <path d="M2 7.5c.7.6 1.4 1.2 2.8 1.2 2.8 0 2.8-2.4 5.7-2.4 2.8 0 2.8 2.4 5.7 2.4 1.3 0 2-.6 2.8-1.2M2 13c.7.6 1.4 1.2 2.8 1.2 2.8 0 2.8-2.4 5.7-2.4 2.8 0 2.8 2.4 5.7 2.4 1.3 0 2-.6 2.8-1.2M2 18.5c.7.6 1.4 1.2 2.8 1.2 2.8 0 2.8-2.4 5.7-2.4 2.8 0 2.8 2.4 5.7 2.4 1.3 0 2-.6 2.8-1.2" />,
    trophy: <>
      <path d="M7 3h10v6a5 5 0 0 1-10 0V3Z" />
      <path d="M7 4H5a2 2 0 0 0 2 4M17 4h2a2 2 0 0 1-2 4" />
      <path d="M12 14v3M9 21h6M9.5 17h5v1a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-1Z" />
    </>,
    clipboard: <>
      <path d="M9 3h6a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" />
      <path d="M8 11h8M8 15h8M8 19h5" />
    </>,
    users: <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
      <circle cx="17.5" cy="8.3" r="2.3" />
      <path d="M15.7 14.7c2.6.4 4.8 2.3 4.8 5.3" />
    </>,
    folder: <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2a1.5 1.5 0 0 1 1.2.6l1.2 1.4h8.4A1.5 1.5 0 0 1 21 8.5v10A1.5 1.5 0 0 1 19.5 20h-15A1.5 1.5 0 0 1 3 18.5v-12Z" />,
  }
  return (
    <svg className={`icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {paths[name] || null}
    </svg>
  )
}

function Stat({ label, value, icon }) { return <div className="stat"><div className="stat-icon"><Icon name={icon} /></div><div><span>{label}</span><strong>{value}</strong></div></div> }
function Quick({ title, icon, onClick }) { return <button className="quick" onClick={onClick}><span className="quick-icon"><Icon name={icon} /></span><strong>{title}</strong><b>←</b></button> }
function PageHead({ title, button, onAdd, count }) { return <div className="page-head"><div><h2>{title}{typeof count === 'number' && <span className="count-badge">{count}</span>}</h2><p>إضافة وتعديل ومتابعة البيانات</p></div>{button && <button className="primary" onClick={onAdd}>＋ {button}</button>}</div> }

function Modal({ title, children, onClose }) {
  return <div className="modal-backdrop"><div className="modal"><div className="modal-head"><h2>{title}</h2><button onClick={onClose}>×</button></div>{children}</div></div>
}

function ClubModal({ form, setForm, onClose, onSave, editing, error }) {
  return <Modal title={editing ? 'تعديل النادي' : 'إضافة نادي ومعلومات المدير'} onClose={onClose}>
    {error && <div className="alert">{error}</div>}
    <form onSubmit={onSave} className="form-grid two">
      <h4 className="wide">معلومات النادي</h4>
      <label>اسم النادي *<input required value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></label>
      <label>المدينة<input value={form.city} onChange={e => setForm({...form, city: e.target.value})} /></label>
      <label>رابط شعار النادي<input placeholder="مثال: /التفوق.jpg أو رابط مباشر" value={form.logo_url} onChange={e => setForm({...form, logo_url: e.target.value})} /></label>
      <label>الهاتف<input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} /></label>
      <label className="wide">البريد الإلكتروني للنادي<input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} /></label>

      {!editing && (
        <>
          <h4 className="wide" style={{marginTop: '1rem', borderTop: '1px solid #ddd', paddingTop: '0.5rem'}}>معلومات مدير النادي (حساب الدخول)</h4>
          <label>الاسم<input value={form.admin_first_name || ''} onChange={e => setForm({...form, admin_first_name: e.target.value})} /></label>
          <label>اللقب<input value={form.admin_last_name || ''} onChange={e => setForm({...form, admin_last_name: e.target.value})} /></label>
          <label>البريد الإلكتروني للمدير *<input type="email" value={form.admin_email || ''} onChange={e => setForm({...form, admin_email: e.target.value})} /></label>
          <label>كلمة المرور للمدير *<input type="password" value={form.admin_password || ''} onChange={e => setForm({...form, admin_password: e.target.value})} /></label>
        </>
      )}

      <div className="form-actions wide">
        <button type="button" onClick={onClose}>إلغاء</button>
        <button className="primary">حفظ</button>
      </div>
    </form>
  </Modal>
}

function SwimmerModal({ form, setForm, setFile, photoFile, setPhotoFile, clubs, isClubAdmin, onClose, onSave, editing, error }) {
  const update = (key, value) => setForm({...form, [key]: value})
  const [photoPreview, setPhotoPreview] = useState(form.photo_url || '')

  useEffect(() => {
    if (!photoFile) { setPhotoPreview(form.photo_url || ''); return }
    const objectUrl = URL.createObjectURL(photoFile)
    setPhotoPreview(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [photoFile])

  return <Modal title={editing ? 'تعديل بيانات السباح' : 'إضافة سباح'} onClose={onClose}>
    {error && <div className="alert">{error}</div>}
    <form onSubmit={onSave} className="form-grid two">
      <label>الاسم *<input required value={form.first_name} onChange={e=>update('first_name',e.target.value)} /></label>
      <label>اللقب *<input required value={form.last_name} onChange={e=>update('last_name',e.target.value)} /></label>
      <label>رقم التسجيل<input value={form.registration_number} onChange={e=>update('registration_number',e.target.value)} /></label>
      <label>تاريخ الميلاد<input type="date" value={form.birth_date} onChange={e=>update('birth_date',e.target.value)} /></label>
      <label>مكان الميلاد<input value={form.birth_place} onChange={e=>update('birth_place',e.target.value)} /></label>
      <label>الجنس<select value={form.gender} onChange={e=>update('gender',e.target.value)}><option>ذكر</option><option>أنثى</option></select></label>
      <label>الهاتف<input value={form.phone} onChange={e=>update('phone',e.target.value)} /></label>
      <label>الفئة *<input required placeholder="مثال: براعم، أصاغر، أواسط..." value={form.category} onChange={e=>update('category',e.target.value)} /></label>
      <label>النادي<select disabled={isClubAdmin} value={form.club_id} onChange={e=>update('club_id',e.target.value)}>{!isClubAdmin && <option value="">بدون نادي</option>}{clubs.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>الحالة<select value={form.status} onChange={e=>update('status',e.target.value)}><option>قيد المراجعة</option><option>معتمد</option><option>مرفوض</option></select></label>
      <label className="wide">الصورة الشخصية
        <div className="photo-upload">
          <img src={photoPreview || '/default-avatar.png'} alt="" className="photo-upload-preview" />
          <input type="file" accept="image/*" onChange={e => setPhotoFile(e.target.files[0] || null)} />
        </div>
      </label>
      <label className="wide">رفع الملف/الوثيقة (PDF / صورة)<input type="file" accept="image/*,.pdf" onChange={e => setFile(e.target.files[0])} /></label>
      <div className="form-actions wide"><button type="button" onClick={onClose}>إلغاء</button><button className="primary">حفظ السباح</button></div>
    </form>
  </Modal>
}

function CompetitionsPage({ competitions, search, setSearch, onAdd, onEdit, onDelete, canManage }) {
  const formatDate = (value) => {
    if (!value) return '—'
    return new Date(`${value}T00:00:00`).toLocaleDateString('ar-DZ', {
      year: 'numeric', month: 'long', day: 'numeric'
    })
  }

  return <section>
    <PageHead title="إدارة المنافسات" button={canManage ? 'إضافة منافسة' : null} onAdd={canManage ? onAdd : undefined} count={competitions.length} />
    <div className="toolbar">
      <input
        placeholder="ابحث باسم المنافسة أو المكان..."
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
    </div>
    <div className="table-card">
      <table>
        <thead><tr><th>اسم المنافسة</th><th>التاريخ</th><th>المكان</th><th>الإجراءات</th></tr></thead>
        <tbody>
          {competitions.map(c => (
            <tr key={c.id}>
              <td><strong>{c.name}</strong></td>
              <td>{formatDate(c.competition_date)}</td>
              <td>{c.location || '—'}</td>
              <td>
                {canManage ? <><button className="small" onClick={() => onEdit(c)}>تعديل</button><button className="small danger" onClick={() => onDelete(c.id)}>حذف</button></> : <span>للاطلاع فقط</span>}
              </td>
            </tr>
          ))}
          {!competitions.length && <tr><td colSpan="4" className="empty">لا توجد منافسات.</td></tr>}
        </tbody>
      </table>
    </div>
  </section>
}

function CompetitionModal({ form, setForm, onClose, onSave, editing, error }) {
  return <Modal title={editing ? 'تعديل المنافسة' : 'إضافة منافسة'} onClose={onClose}>
    {error && <div className="alert">{error}</div>}
    <form onSubmit={onSave} className="form-grid">
      <label className="wide">اسم المنافسة *
        <input required value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
      </label>
      <label>تاريخ المنافسة
        <input type="date" value={form.competition_date} onChange={e => setForm({...form, competition_date: e.target.value})} />
      </label>
      <label>المكان
        <input value={form.location} onChange={e => setForm({...form, location: e.target.value})} />
      </label>
      <div className="form-actions wide">
        <button type="button" onClick={onClose}>إلغاء</button>
        <button className="primary">حفظ المنافسة</button>
      </div>
    </form>
  </Modal>
}

export default App
