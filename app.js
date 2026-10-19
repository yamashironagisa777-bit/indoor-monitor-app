(() => {
  // 簡易ログイン用の設定（GitHub Pagesではソースコードから確認できます）
  // 必ず変更してください。ただし変更しても本格的なアクセス制御にはなりません。
  const LOGIN_USERNAME = 'kazoku';
  const LOGIN_PASSWORD = 'change-this-password';

  const loginScreen = document.getElementById('loginScreen');
  const appContent = document.getElementById('appContent');
  const loginForm = document.getElementById('loginForm');
  const loginError = document.getElementById('loginError');
  const logoutButton = document.getElementById('logoutButton');

  function showApp() {
    loginScreen.hidden = true;
    appContent.hidden = false;
    startMonitorApp();
  }

  function showLogin() {
    appContent.hidden = true;
    loginScreen.hidden = false;
    document.getElementById('loginPassword').value = '';
  }

  loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    if (username === LOGIN_USERNAME && password === LOGIN_PASSWORD) {
      sessionStorage.setItem('indoorMonitorLoggedIn', '1');
      loginError.textContent = '';
      showApp();
    } else {
      loginError.textContent = 'ユーザー名またはパスワードが違います。';
    }
  });

  logoutButton.addEventListener('click', () => {
    sessionStorage.removeItem('indoorMonitorLoggedIn');
    showLogin();
  });

  function startMonitorApp() {
    if (window.monitorAppStarted) return;
    window.monitorAppStarted = true;

  const cfg = window.MONITOR_CONFIG || {};
  const $ = id => document.getElementById(id);
  const labels = {1:{title:'室温の推移',legend:'室温（℃）',unit:'℃'},2:{title:'湿度の推移',legend:'湿度（%）',unit:'%'},3:{title:'ガスセンサー値の推移',legend:'ガスセンサー値（校正前）',unit:''}};
  let selectedField = '1';
  let latestFeed = null;
  let feeds = [];
  let loading = false;
  const validConfig = () => cfg.channelId && cfg.readApiKey && !String(cfg.channelId).includes('YOUR_') && !String(cfg.readApiKey).includes('YOUR_');
  function setConnection(ok, text) { $('connectionDot').className = 'dot ' + (ok ? 'ok' : 'bad'); $('connectionText').textContent = text; }
  function setAlert(kind, title, detail, icon) { const el = $('alertCard'); el.className = 'alert-card' + (kind ? ' ' + kind : ''); $('alertTitle').textContent = title; $('alertDetail').textContent = detail; $('alertIcon').textContent = icon; }
  function fmtNum(v, digits=1) { if (v === null || v === undefined || v === '') return '--'; const n = Number(v); return Number.isFinite(n) ? n.toFixed(digits) : '--'; }
  function statusText(v, yes, no) { if (v === null || v === undefined || v === '') return '--'; return Number(v) >= 1 ? yes : no; }
  function renderLatest(f) {
    if (!f) return;
    $('temperature').textContent = fmtNum(f.field1);
    $('humidity').textContent = fmtNum(f.field2);
    $('gas').textContent = fmtNum(f.field3, 0);
    $('door').textContent = statusText(f.field4, '開いています', '閉まっています');
    $('bed').textContent = statusText(f.field5, '在床あり', '在床なし');
    if (f.created_at) {
      const d = new Date(f.created_at);
      $('updatedAt').textContent = '最終更新：' + (Number.isNaN(d.getTime()) ? f.created_at : d.toLocaleString('ja-JP'));
      const age = Date.now() - d.getTime();
      if (Number.isFinite(age) && age > 5 * 60 * 1000) setAlert('warning','データの更新が遅れています','最後の記録から5分以上経過しています。Raspberry Piとネットワークを確認してください。','!');
      else setAlert('', '監視データを受信しています', '以下はクラウドに保存された最新の測定値です。','✓');
    }
    if (f.field1 !== '' && Number(f.field1) >= 30) setAlert('warning','室温が高くなっています','室温が30℃以上です。現地の状況を確認してください。','!');
  }
  async function api(path) {
    const url = `https://api.thingspeak.com/channels/${encodeURIComponent(cfg.channelId)}/${path}${path.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(cfg.readApiKey)}`;
    const res = await fetch(url, {cache:'no-store'});
    if (!res.ok) throw new Error('クラウドAPIエラー: HTTP ' + res.status);
    return res.json();
  }
  async function refresh() {
    if (loading) return;
    if (!validConfig()) { setConnection(false,'初期設定が必要です'); setAlert('warning','クラウド設定が未完了です','config.js にチャンネルIDと読み取りAPIキーを設定してください。','!'); $('chartEmpty').textContent='config.js の設定後に履歴が表示されます。'; return; }
    loading = true;
    try {
      const [last, history] = await Promise.all([api('feeds/last.json'), api(`feeds.json?results=${Math.min(8000, Math.max(1, Number(cfg.historyResults)||100))}`)]);
      if (last && last.created_at) { latestFeed = last; renderLatest(last); }
      feeds = Array.isArray(history.feeds) ? history.feeds : [];
      if (!latestFeed && feeds.length) { latestFeed = feeds[feeds.length-1]; renderLatest(latestFeed); }
      if (!latestFeed) throw new Error('データがまだありません。Piから最初のデータを送信してください。');
      setConnection(true,'クラウド接続中'); drawChart();
    } catch (e) {
      setConnection(false,'接続できません');
      if (!latestFeed) setAlert('error','データを取得できません', e.message + ' チャンネルID・Read API Key・インターネット接続を確認してください。','×');
      $('chartEmpty').textContent = 'データを取得できません。設定と通信を確認してください。';
    } finally { loading = false; }
  }
  function drawChart() {
    const canvas = $('historyChart'), ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    const dpr = window.devicePixelRatio || 1; canvas.width = Math.round(rect.width*dpr); canvas.height = Math.round(rect.height*dpr); ctx.setTransform(dpr,0,0,dpr,0,0);
    const w = rect.width, h = rect.height; ctx.clearRect(0,0,w,h);
    const data = feeds.filter(f => f['field'+selectedField] !== null && f['field'+selectedField] !== '' && Number.isFinite(Number(f['field'+selectedField]))).slice(-100);
    const meta = labels[selectedField]; $('chartTitle').textContent=meta.title; $('legendText').textContent=meta.legend; $('chartRange').textContent=data.length ? `${data.length}件の記録` : '記録なし';
    $('chartEmpty').style.display = data.length ? 'none':'grid'; if (!data.length) return;
    const pad={l:42,r:12,t:14,b:34}, cw=w-pad.l-pad.r, ch=h-pad.t-pad.b;
    const vals=data.map(f=>Number(f['field'+selectedField])); let min=Math.min(...vals), max=Math.max(...vals); if(min===max){min-=1;max+=1;} const margin=(max-min)*.12; min-=margin; max+=margin;
    ctx.font='10px system-ui, sans-serif'; ctx.lineWidth=1; ctx.strokeStyle='#e5ebf0'; ctx.fillStyle='#738391';
    for(let i=0;i<5;i++){const y=pad.t+ch*i/4;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();const v=max-(max-min)*i/4;ctx.textAlign='right';ctx.textBaseline='middle';ctx.fillText(v.toFixed(selectedField==='3'?0:1),pad.l-7,y);}
    const pts=data.map((f,i)=>({x:pad.l+(data.length===1?cw/2:cw*i/(data.length-1)),y:pad.t+ch*(max-Number(f['field'+selectedField]))/(max-min),t:new Date(f.created_at)}));
    ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.strokeStyle='#2276a8';ctx.lineWidth=2.5;ctx.lineJoin='round';ctx.lineCap='round';ctx.stroke();
    if(pts.length<60){pts.forEach(p=>{ctx.beginPath();ctx.arc(p.x,p.y,3,0,Math.PI*2);ctx.fillStyle='#2276a8';ctx.fill();});}
    ctx.fillStyle='#738391';ctx.textBaseline='top';ctx.textAlign='left';ctx.fillText(pts[0].t.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}),pad.l,h-pad.b+12);ctx.textAlign='right';ctx.fillText(pts[pts.length-1].t.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}),w-pad.r,h-pad.b+12);
  }
  document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');selectedField=b.dataset.field;drawChart();}));
  $('refreshBtn').addEventListener('click',refresh); $('historyRefresh').addEventListener('click',refresh); window.addEventListener('resize',drawChart);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
  refresh(); setInterval(refresh, Math.max(30000, Number(cfg.refreshMs)||30000));

  }

  if (sessionStorage.getItem('indoorMonitorLoggedIn') === '1') {
    showApp();
  } else {
    showLogin();
  }
})();
