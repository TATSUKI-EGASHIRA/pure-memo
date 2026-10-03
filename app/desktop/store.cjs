const { DatabaseSync, backup } = require('node:sqlite');
const { randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {retryDelay}=require('./job-policy.cjs');
const MAX_IMAGE_BYTES=8*1024*1024;
function savedSourceCanPreview(originKind){return originKind!=='generated';}
function firstSourceUrl(body){
  const raw=(body.match(/https?:\/\/[^\s<>"']+/i)?.[0]||'').replace(/[.,、。!?！？，）)\]]+$/,'').slice(0,2048);
  if(!raw)return '';
  try{const url=new URL(raw);return ['http:','https:'].includes(url.protocol)?url.href:'';}catch{return '';}
}
function decodeImage(input){
  const mediaType=String(input?.mediaType||'');
  const encoded=input?.dataBase64;
  if(!['image/png','image/jpeg','image/gif','image/webp'].includes(mediaType)||typeof encoded!=='string'||!encoded||encoded.length>Math.ceil(MAX_IMAGE_BYTES/3)*4+8||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw new Error('Use a PNG, JPEG, GIF or WebP image up to 8 MB.');
  const bytes=Buffer.from(encoded,'base64');
  if(!bytes.length||bytes.length>MAX_IMAGE_BYTES||bytes.toString('base64')!==encoded)throw new Error('Invalid image data.');
  const signature=mediaType==='image/png'?bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):
    mediaType==='image/jpeg'?bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex')):
    mediaType==='image/gif'?['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString('ascii')):
    bytes.subarray(0,4).toString('ascii')==='RIFF'&&bytes.subarray(8,12).toString('ascii')==='WEBP';
  if(!signature)throw new Error('Image content does not match its format.');
  return {bytes,mediaType,fileName:String(input.fileName||'Image').slice(0,120)};
}

const BACKFILL_ASK_OVER=300,BACKFILL_RECENT_DAYS=365;
class Store {
  constructor(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.file = file;
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000; PRAGMA secure_delete = ON;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY, current_revision_id TEXT, created_at TEXT NOT NULL,
        origin_kind TEXT NOT NULL DEFAULT 'human', is_demo INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT
      );
      CREATE TABLE IF NOT EXISTS purged_notes (
        id TEXT PRIMARY KEY, purged_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS note_revisions (
        id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES notes(id),
        body TEXT NOT NULL, created_at TEXT NOT NULL,
        source_kind TEXT NOT NULL DEFAULT 'unspecified', source_url TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS article_previews (
        revision_id TEXT PRIMARY KEY REFERENCES note_revisions(id),
        status TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '', site_name TEXT NOT NULL DEFAULT '',
        fetched_at TEXT, error TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES notes(id),
        media_type TEXT NOT NULL, file_name TEXT NOT NULL, content_hash TEXT NOT NULL,
        bytes BLOB NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_attachments_note ON attachments(note_id);
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS category_revisions (
        id TEXT PRIMARY KEY, category_id TEXT NOT NULL REFERENCES categories(id),
        name TEXT NOT NULL, origin TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS category_transitions (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL,
        source_category_id TEXT NOT NULL REFERENCES categories(id),
        target_category_id TEXT NOT NULL REFERENCES categories(id),
        moved_count INTEGER NOT NULL, skipped_count INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS assignments (
        note_id TEXT NOT NULL REFERENCES notes(id), category_id TEXT NOT NULL REFERENCES categories(id),
        revision_id TEXT NOT NULL REFERENCES note_revisions(id), origin TEXT NOT NULL,
        PRIMARY KEY(note_id, category_id)
      );
      CREATE TABLE IF NOT EXISTS assignment_exclusions (
        note_id TEXT NOT NULL REFERENCES notes(id), category_id TEXT NOT NULL REFERENCES categories(id),
        revision_id TEXT NOT NULL REFERENCES note_revisions(id), created_at TEXT NOT NULL,
        PRIMARY KEY(note_id, category_id)
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, purpose TEXT NOT NULL, category_id TEXT,
        model TEXT NOT NULL, prompt_version TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS outputs (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), kind TEXT NOT NULL,
        text TEXT NOT NULL, category_id TEXT, status TEXT NOT NULL DEFAULT 'current',
        analysis_status TEXT NOT NULL DEFAULT 'ready', parent_output_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS evidence (
        output_id TEXT NOT NULL REFERENCES outputs(id), revision_id TEXT NOT NULL REFERENCES note_revisions(id),
        PRIMARY KEY(output_id, revision_id)
      );
      CREATE TABLE IF NOT EXISTS analysis_inputs (
        run_id TEXT NOT NULL REFERENCES runs(id), revision_id TEXT NOT NULL REFERENCES note_revisions(id),
        PRIMARY KEY(run_id, revision_id)
      );
      CREATE INDEX IF NOT EXISTS idx_analysis_inputs_revision ON analysis_inputs(revision_id);
      CREATE TABLE IF NOT EXISTS digest_claims (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), kind TEXT NOT NULL,
        speaker TEXT NOT NULL, period TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS digest_claim_evidence (
        claim_id TEXT NOT NULL REFERENCES digest_claims(id), revision_id TEXT NOT NULL REFERENCES note_revisions(id),
        relation TEXT NOT NULL, PRIMARY KEY(claim_id, revision_id, relation)
      );
      CREATE INDEX IF NOT EXISTS idx_digest_claims_run ON digest_claims(run_id);
      CREATE TABLE IF NOT EXISTS answer_claims (
        id TEXT PRIMARY KEY, output_id TEXT NOT NULL REFERENCES outputs(id), kind TEXT NOT NULL,
        speaker TEXT NOT NULL, period TEXT NOT NULL, text TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS answer_claim_evidence (
        claim_id TEXT NOT NULL REFERENCES answer_claims(id), revision_id TEXT NOT NULL REFERENCES note_revisions(id),
        PRIMARY KEY(claim_id, revision_id)
      );
      CREATE INDEX IF NOT EXISTS idx_answer_claims_output ON answer_claims(output_id);
      CREATE TABLE IF NOT EXISTS feedback (
        id TEXT PRIMARY KEY, output_id TEXT NOT NULL REFERENCES outputs(id),
        rating TEXT NOT NULL, reason TEXT, comment TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ask_questions (
        id TEXT PRIMARY KEY, question TEXT NOT NULL, output_id TEXT NOT NULL REFERENCES outputs(id),
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS classification_jobs (
        note_id TEXT PRIMARY KEY REFERENCES notes(id), revision_id TEXT NOT NULL REFERENCES note_revisions(id),
        model TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS digest_jobs (
        category_id TEXT PRIMARY KEY REFERENCES categories(id), fingerprint TEXT NOT NULL,
        model TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS note_embeddings (
        revision_id TEXT PRIMARY KEY REFERENCES note_revisions(id), model TEXT NOT NULL,
        vector BLOB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS retrieval_items (
        run_id TEXT NOT NULL REFERENCES runs(id), revision_id TEXT NOT NULL REFERENCES note_revisions(id),
        rank INTEGER NOT NULL, score REAL NOT NULL, method TEXT NOT NULL,
        PRIMARY KEY(run_id, revision_id)
      );
      CREATE INDEX IF NOT EXISTS idx_evidence_revision ON evidence(revision_id);
      CREATE INDEX IF NOT EXISTS idx_outputs_category ON outputs(category_id, created_at);
    `);
    const noteColumns=this.db.prepare('PRAGMA table_info(notes)').all().map(column=>column.name);
    if(!noteColumns.includes('ai_excluded'))this.db.exec('ALTER TABLE notes ADD COLUMN ai_excluded INTEGER NOT NULL DEFAULT 0');
    if(!noteColumns.includes('ai_access_version'))this.db.exec('ALTER TABLE notes ADD COLUMN ai_access_version INTEGER NOT NULL DEFAULT 0');
    const runColumns=this.db.prepare('PRAGMA table_info(runs)').all().map(column=>column.name);
    if(!runColumns.includes('ai_blocked'))this.db.exec('ALTER TABLE runs ADD COLUMN ai_blocked INTEGER NOT NULL DEFAULT 0');
    if(!runColumns.includes('context_tracked'))this.db.exec('ALTER TABLE runs ADD COLUMN context_tracked INTEGER NOT NULL DEFAULT 0');
    this.db.exec(`CREATE TABLE IF NOT EXISTS run_contexts (
      run_id TEXT NOT NULL REFERENCES runs(id), source_run_id TEXT NOT NULL REFERENCES runs(id),
      PRIMARY KEY(run_id,source_run_id)
    )`);
    if(!this.db.prepare('PRAGMA table_info(feedback)').all().some(c=>c.name==='comment')) this.db.exec('ALTER TABLE feedback ADD COLUMN comment TEXT');
    const revisionColumns=this.db.prepare('PRAGMA table_info(note_revisions)').all().map(c=>c.name);
    if(!revisionColumns.includes('source_kind'))this.db.exec("ALTER TABLE note_revisions ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'unspecified'");
    if(!revisionColumns.includes('source_url'))this.db.exec("ALTER TABLE note_revisions ADD COLUMN source_url TEXT NOT NULL DEFAULT ''");
    // Quick capture: the selected text (excerpt) is kept apart from the user's own words (body).
    if(!revisionColumns.includes('excerpt'))this.db.exec("ALTER TABLE note_revisions ADD COLUMN excerpt TEXT NOT NULL DEFAULT ''");
    if(!revisionColumns.includes('source_title'))this.db.exec("ALTER TABLE note_revisions ADD COLUMN source_title TEXT NOT NULL DEFAULT ''");
    if(!revisionColumns.includes('source_app'))this.db.exec("ALTER TABLE note_revisions ADD COLUMN source_app TEXT NOT NULL DEFAULT ''");
    // Linked pages keep their readable text so AI can use what the link says, not only that it exists.
    const articleColumns=this.db.prepare('PRAGMA table_info(article_previews)').all().map(c=>c.name);
    if(!articleColumns.includes('body'))this.db.exec("ALTER TABLE article_previews ADD COLUMN body TEXT NOT NULL DEFAULT ''");
    if(!articleColumns.includes('author'))this.db.exec("ALTER TABLE article_previews ADD COLUMN author TEXT NOT NULL DEFAULT ''");
    if(!articleColumns.includes('published_at'))this.db.exec("ALTER TABLE article_previews ADD COLUMN published_at TEXT NOT NULL DEFAULT ''");
    // What the page itself lists (for a video: length and the songs in it), as JSON.
    if(!articleColumns.includes('media'))this.db.exec("ALTER TABLE article_previews ADD COLUMN media TEXT NOT NULL DEFAULT ''");
    // What AI read from a linked page for one revision: what it is, its title and creator, what the
    // note says to do with it, and a short summary. AI output, so it goes with AI exclusion.
    // One row per AI call: what for, which prompt version and model, time, tokens and outcome. Never
    // the prompt or the answer. Kept to the latest 2000.
    this.db.exec(`CREATE TABLE IF NOT EXISTS ai_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, purpose TEXT NOT NULL, prompt_version TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '', effort TEXT, ms INTEGER NOT NULL, input_tokens INTEGER, cached_input_tokens INTEGER,
      output_tokens INTEGER, reasoning_tokens INTEGER, status TEXT NOT NULL, error TEXT NOT NULL DEFAULT '')`);
    if(!this.db.prepare('PRAGMA table_info(ai_calls)').all().some(c=>c.name==='provider'))this.db.exec("ALTER TABLE ai_calls ADD COLUMN provider TEXT NOT NULL DEFAULT 'codex'");
    // News collected for the topics the user chose (see news.cjs). Not note data; kept 14 days.
    this.db.exec(`CREATE TABLE IF NOT EXISTS news_items (
      url TEXT PRIMARY KEY, title TEXT NOT NULL, title_localized TEXT NOT NULL DEFAULT '', locale TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL, via TEXT NOT NULL, topic TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
      discussion TEXT NOT NULL DEFAULT '', published_at TEXT NOT NULL DEFAULT '', fetched_at TEXT NOT NULL)`);
    // Links the relevance check left out, so they are not sent to AI again every day.
    this.db.exec('CREATE TABLE IF NOT EXISTS news_left_out (url TEXT PRIMARY KEY, at TEXT NOT NULL)');
    // The memory layer: what each note says about the person (a preference, something done or wanted,
    // a habit, an opinion), read once when the note is saved, with the note's own words as the quote.
    // Features read this instead of re-reading every note. AI output, so it follows AI exclusion.
    this.db.exec(`CREATE TABLE IF NOT EXISTS memory_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, note_id TEXT NOT NULL, revision_id TEXT NOT NULL REFERENCES note_revisions(id),
      kind TEXT NOT NULL, subject TEXT NOT NULL, entity_type TEXT NOT NULL, statement TEXT NOT NULL, polarity TEXT NOT NULL,
      speaker TEXT NOT NULL, period TEXT NOT NULL DEFAULT '', quote TEXT NOT NULL, model TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)`);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_memory_facts_revision ON memory_facts(revision_id)');
    // The profile (profile.cjs): one line per topic, built from memory_facts and pointing back to them.
    this.db.exec(`CREATE TABLE IF NOT EXISTS memory_profile (
      key TEXT PRIMARY KEY, label TEXT NOT NULL, line TEXT NOT NULL, status TEXT NOT NULL, entity_type TEXT NOT NULL DEFAULT 'other',
      mentions INTEGER NOT NULL, first_at TEXT NOT NULL, latest_at TEXT NOT NULL, score REAL NOT NULL, fact_ids TEXT NOT NULL, locale TEXT NOT NULL DEFAULT 'ja', updated_at TEXT NOT NULL)`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS link_readings (
      revision_id TEXT PRIMARY KEY REFERENCES note_revisions(id), kind TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
      creator TEXT NOT NULL DEFAULT '', intent TEXT NOT NULL DEFAULT 'none', summary TEXT NOT NULL DEFAULT '',
      locale TEXT NOT NULL DEFAULT 'ja', model TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)`);
    // Once: re-read links saved before bodies were kept, and those that failed on the old DNS lookup.
    if(!this.db.prepare("SELECT 1 FROM app_state WHERE key='article_body_v1'").get()){
      this.db.exec("UPDATE article_previews SET status='pending',error='' WHERE (status='ready' AND body='') OR (status='failed' AND error LIKE 'Invalid IP address%')");
      this.db.exec("INSERT INTO app_state(key,value) VALUES('article_body_v1','done')");
    }
    this.db.exec(`INSERT OR IGNORE INTO article_previews(revision_id,status)
      SELECT r.id,'pending' FROM notes n JOIN note_revisions r ON r.id=n.current_revision_id
      WHERE n.deleted_at IS NULL AND n.origin_kind='human' AND n.is_demo=0 AND r.source_url!=''`);
    const outputColumns=this.db.prepare('PRAGMA table_info(outputs)').all().map(c=>c.name);
    if(!outputColumns.includes('analysis_status'))this.db.exec("ALTER TABLE outputs ADD COLUMN analysis_status TEXT NOT NULL DEFAULT 'ready'");
    if(!outputColumns.includes('parent_output_id'))this.db.exec('ALTER TABLE outputs ADD COLUMN parent_output_id TEXT');
    const version=this.db.prepare('PRAGMA user_version').get().user_version;
    if(version<3){
      this.db.exec(`UPDATE categories SET state='unconfirmed' WHERE id!='all' AND state='active'
        AND COALESCE((SELECT origin FROM category_revisions WHERE category_id=categories.id ORDER BY created_at DESC,rowid DESC LIMIT 1),'ai')!='human'`);
      this.db.exec('PRAGMA user_version = 3');
    }
    this.db.prepare(`INSERT OR IGNORE INTO categories(id,name,created_at) VALUES('all','All notes',?)`).run(new Date().toISOString());
    for(const table of ['classification_jobs','digest_jobs']){
      const columns=this.db.prepare(`PRAGMA table_info(${table})`).all().map(column=>column.name);
      if(!columns.includes('token'))this.db.exec(`ALTER TABLE ${table} ADD COLUMN token TEXT NOT NULL DEFAULT ''`);
      if(!columns.includes('retry_after'))this.db.exec(`ALTER TABLE ${table} ADD COLUMN retry_after INTEGER`);
      // A job that only reads the note into the memory layer and leaves its categories alone.
      if(table==='classification_jobs'&&!columns.includes('facts_only'))this.db.exec('ALTER TABLE classification_jobs ADD COLUMN facts_only INTEGER NOT NULL DEFAULT 0');
      // Set once a revision has been read into the memory layer (even when it said nothing to keep).
      if(table==='classification_jobs'&&!columns.includes('facts_read'))this.db.exec('ALTER TABLE classification_jobs ADD COLUMN facts_read INTEGER NOT NULL DEFAULT 0');
      this.db.exec(`UPDATE ${table} SET token=lower(hex(randomblob(16))) WHERE token=''`);
      this.db.exec(`UPDATE ${table} SET token=lower(hex(randomblob(16))) WHERE state='running'`);
    }
    this.db.exec("UPDATE classification_jobs SET state='pending' WHERE state='running'");
    this.db.exec("UPDATE digest_jobs SET state='pending' WHERE state='running'");
    this.db.exec("UPDATE article_previews SET status='pending' WHERE status='running'");
  }
  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  listNotes() {
    return this.db.prepare(`SELECT n.id, n.current_revision_id AS revisionId, r.body AS text,r.excerpt AS excerpt,r.source_title AS sourceTitle,r.source_app AS sourceApp,
      n.created_at AS date, n.origin_kind AS originKind, n.is_demo AS isDemo,n.ai_excluded AS aiExcluded,n.ai_access_version AS aiAccessVersion,
      r.source_kind AS sourceKind,r.source_url AS sourceUrl,
      ap.status AS articleStatus,ap.title AS articleTitle,
      ap.description AS articleDescription,ap.site_name AS articleSiteName,
      ap.fetched_at AS articleFetchedAt,ap.error AS articleError,length(ap.body) AS articleChars,
      lr.kind AS linkKind,lr.title AS linkTitle,lr.creator AS linkCreator,lr.intent AS linkIntent,lr.summary AS linkSummary,
      (SELECT group_concat(a.category_id,char(31)) FROM assignments a JOIN categories c ON c.id=a.category_id
        WHERE a.note_id=n.id AND a.revision_id=n.current_revision_id AND c.state='active' AND c.id NOT IN ('all','other')) AS categoryIdList,
      (SELECT j.state FROM classification_jobs j WHERE j.note_id=n.id AND j.revision_id=n.current_revision_id) AS classificationState
      FROM notes n JOIN note_revisions r ON r.id=n.current_revision_id
      LEFT JOIN article_previews ap ON ap.revision_id=r.id
      LEFT JOIN link_readings lr ON lr.revision_id=r.id AND n.ai_excluded=0
      WHERE n.deleted_at IS NULL ORDER BY n.created_at DESC`).all().map(({categoryIdList,classificationState,...n}) => ({...n, isDemo:!!n.isDemo,aiExcluded:!!n.aiExcluded, categoryIds:categoryIdList?categoryIdList.split('\u001f').sort():[], classificationState:classificationState||null, attachments:this.attachmentsFor(n.id)}));
  }
  listTrash() {
    return this.db.prepare(`SELECT n.id, n.current_revision_id AS revisionId, r.body AS text,r.excerpt AS excerpt,r.source_title AS sourceTitle,r.source_app AS sourceApp,
      n.created_at AS date, n.deleted_at AS deletedAt, n.origin_kind AS originKind, n.is_demo AS isDemo,n.ai_excluded AS aiExcluded,n.ai_access_version AS aiAccessVersion,
      r.source_kind AS sourceKind,r.source_url AS sourceUrl
      FROM notes n JOIN note_revisions r ON r.id=n.current_revision_id
      WHERE n.deleted_at IS NOT NULL ORDER BY n.deleted_at DESC`).all().map(n=>({...n,isDemo:!!n.isDemo,aiExcluded:!!n.aiExcluded,attachments:this.attachmentsFor(n.id)}));
  }
  nextArticlePreviewJob(){
    return this.db.prepare(`SELECT n.id AS noteId,r.id AS revisionId,r.source_url AS url
      FROM article_previews ap JOIN note_revisions r ON r.id=ap.revision_id
      JOIN notes n ON n.current_revision_id=r.id
      WHERE ap.status='pending' AND n.deleted_at IS NULL AND n.origin_kind='human' AND n.is_demo=0
      ORDER BY n.created_at LIMIT 1`).get();
  }
  markArticlePreviewRunning(revisionId){
    return !!this.db.prepare("UPDATE article_previews SET status='running' WHERE revision_id=? AND status='pending'").run(revisionId).changes;
  }
  finishArticlePreview(revisionId,preview){
    return !!this.db.prepare(`UPDATE article_previews SET status='ready',title=?,description=?,site_name=?,body=?,author=?,published_at=?,media=?,fetched_at=?,error=''
      WHERE revision_id=? AND status='running' AND EXISTS (
        SELECT 1 FROM notes n WHERE n.current_revision_id=article_previews.revision_id AND n.deleted_at IS NULL
      )`).run(String(preview.title||'').slice(0,300),String(preview.description||'').slice(0,600),String(preview.siteName||'').slice(0,120),
        String(preview.text||'').slice(0,20000),String(preview.author||'').slice(0,120),String(preview.publishedAt||'').slice(0,40),preview.media?JSON.stringify(preview.media).slice(0,4000):'',new Date().toISOString(),revisionId).changes;
  }
  failArticlePreview(revisionId,error){
    return !!this.db.prepare("UPDATE article_previews SET status='failed',error=? WHERE revision_id=? AND status='running'").run(String(error?.message||error||'Preview unavailable').slice(0,200),revisionId).changes;
  }
  retryArticlePreview(noteId){
    return !!this.db.prepare(`UPDATE article_previews SET status='pending',error='' WHERE revision_id=(
      SELECT current_revision_id FROM notes WHERE id=? AND deleted_at IS NULL
    ) AND status='failed'`).run(noteId).changes;
  }
  // The fetched page text for the detail panel (not part of the note list, which stays light).
  articleText(noteId){
    return this.db.prepare(`SELECT ap.body AS text,ap.title,ap.site_name AS siteName,ap.author,ap.published_at AS publishedAt,ap.fetched_at AS fetchedAt
      FROM notes n JOIN article_previews ap ON ap.revision_id=n.current_revision_id WHERE n.id=? AND n.deleted_at IS NULL AND ap.status='ready'`).get(noteId)||null;
  }
  // Notes going to AI carry the text of their linked page, marked as external material.
  withArticles(notes){
    if(!notes.length)return notes;
    const query=this.db.prepare("SELECT title,site_name AS siteName,description,body,author,media FROM article_previews WHERE revision_id=? AND status='ready'");
    return notes.map(note=>{
      const row=query.get(note.revisionId);
      if(!row||!(row.body||row.description||row.title))return note;
      let media=null;try{media=row.media?JSON.parse(row.media):null}catch{}
      return {...note,article:{title:row.title,siteName:row.siteName,description:row.description,text:row.body||row.description,
        ...(row.author?{author:row.author}:{}),...(media?.tracks?.length?{tracks:media.tracks}:{}),...(media?.duration?{duration:media.duration}:{})}};
    });
  }
  articleUrl(noteId){
    return this.db.prepare(`SELECT r.source_url AS url FROM notes n JOIN note_revisions r ON r.id=n.current_revision_id
      WHERE n.id=? AND n.deleted_at IS NULL`).get(noteId)?.url||'';
  }
  attachmentsFor(noteId){
    return this.db.prepare('SELECT id,media_type AS mediaType,file_name AS fileName,length(bytes) AS size FROM attachments WHERE note_id=? ORDER BY created_at,id').all(noteId);
  }
  readAttachment(id){
    const row=this.db.prepare('SELECT a.id,a.media_type AS mediaType,a.bytes FROM attachments a JOIN notes n ON n.id=a.note_id WHERE a.id=? AND n.deleted_at IS NULL').get(id);
    if(!row)throw new Error('Image not found.');
    return {id:row.id,mediaType:row.mediaType,dataBase64:Buffer.from(row.bytes).toString('base64')};
  }
  removeAttachment(id){
    return this.tx(()=>{
      const row=this.db.prepare('SELECT a.note_id AS noteId,r.body FROM attachments a JOIN notes n ON n.id=a.note_id JOIN note_revisions r ON r.id=n.current_revision_id WHERE a.id=? AND n.deleted_at IS NULL').get(id);
      if(!row)throw new Error('Image not found.');
      if(!row.body.trim()&&this.attachmentsFor(row.noteId).length===1)throw new Error('Add text before removing the last image.');
      this.db.prepare('DELETE FROM attachments WHERE id=?').run(id);
      return row.noteId;
    });
  }
  saveNote(input) {
    if(input?.aiExcluded!==undefined&&typeof input.aiExcluded!=='boolean')throw new Error('AI解析の設定が不正です。');
    let body = String(input?.text || '').trim();
    let requestedKind=input?.sourceKind||'unspecified';
    if(!['unspecified','thought','reference','quote'].includes(requestedKind))throw new Error('Invalid source type.');
    // Edits that do not mention the capture fields keep the ones already saved.
    const previous=input?.id&&input.excerpt===undefined?this.db.prepare('SELECT r.excerpt,r.source_title AS sourceTitle,r.source_app AS sourceApp,r.source_url AS sourceUrl FROM notes n JOIN note_revisions r ON r.id=n.current_revision_id WHERE n.id=?').get(input.id):null;
    let excerpt=String(previous?previous.excerpt:input?.excerpt||'').trim();
    if(excerpt.length>20000)throw new Error('Selected text must contain at most 20000 characters.');
    // Only selected text: a plain quote. Selected text plus own words: the words are the user's thought.
    if(excerpt&&!body){body=excerpt;excerpt='';if(requestedKind==='unspecified')requestedKind='quote';}
    else if(excerpt&&requestedKind==='unspecified')requestedKind='thought';
    const urlOnly=/^https?:\/\/[^\s]+$/i.test(body);
    const sourceKind=requestedKind==='unspecified'&&urlOnly?'reference':requestedKind;
    const captured=previous&&(previous.excerpt||previous.sourceTitle||previous.sourceApp);
    const sourceUrl=firstSourceUrl(String(input?.sourceUrl||''))||firstSourceUrl(body)||(captured?firstSourceUrl(previous.sourceUrl||''):'')||firstSourceUrl(excerpt);
    const sourceTitle=String(previous?previous.sourceTitle:input?.sourceTitle||'').trim().slice(0,300);
    const sourceApp=String(previous?previous.sourceApp:input?.sourceApp||'').trim().slice(0,120);
    const incoming=Array.isArray(input?.attachments)?input.attachments:[];
    if(incoming.length>4)throw new Error('Attach up to four images.');
    const images=incoming.map(decodeImage);
    if(body.length>100000)throw new Error('Note must contain at most 100000 characters.');
    return this.tx(() => {
      const id = input.id || randomUUID();
      const current = this.db.prepare('SELECT id, deleted_at FROM notes WHERE id=?').get(id);
      if (current?.deleted_at) throw new Error('This note is in the trash.');
      if (input.id && !current) throw new Error('Note not found.');
      if(!body&&!images.length&&(!current||!this.attachmentsFor(id).length))throw new Error('Write a note or attach an image.');
      if(images.length+(current?this.attachmentsFor(id).length:0)>4)throw new Error('Attach up to four images.');
      const revisionId = randomUUID(), now = new Date().toISOString();
      if (!current) this.db.prepare('INSERT INTO notes(id,created_at,origin_kind,ai_excluded) VALUES(?,?,?,?)').run(id,now,input.originKind==='generated'?'generated':'human',input.aiExcluded?1:0);
      this.db.prepare('INSERT INTO note_revisions(id,note_id,body,created_at,source_kind,source_url,excerpt,source_title,source_app) VALUES(?,?,?,?,?,?,?,?,?)').run(revisionId,id,body,now,sourceKind,sourceUrl,excerpt,sourceTitle,sourceApp);
      if(sourceUrl&&savedSourceCanPreview(input.originKind))this.db.prepare("INSERT INTO article_previews(revision_id,status) VALUES(?,'pending')").run(revisionId);
      this.db.prepare('UPDATE notes SET current_revision_id=? WHERE id=?').run(revisionId,id);
      for(const image of images)this.db.prepare('INSERT INTO attachments(id,note_id,media_type,file_name,content_hash,bytes,created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),id,image.mediaType,image.fileName,createHash('sha256').update(image.bytes).digest('hex'),image.bytes,now);
      if (current) this.db.prepare('UPDATE assignments SET revision_id=? WHERE note_id=? AND origin=\'human\'').run(revisionId,id);
      if (current) this.db.prepare(`WITH RECURSIVE impacted(id) AS (
        SELECT ai.run_id FROM analysis_inputs ai JOIN note_revisions r ON r.id=ai.revision_id WHERE r.note_id=?
        UNION SELECT o.run_id FROM evidence e JOIN outputs o ON o.id=e.output_id JOIN note_revisions r ON r.id=e.revision_id WHERE r.note_id=?
        UNION SELECT rc.run_id FROM run_contexts rc JOIN impacted i ON rc.source_run_id=i.id
      ) UPDATE outputs SET status='stale' WHERE run_id IN (SELECT id FROM impacted)`).run(id,id);
      this.db.prepare('DELETE FROM classification_jobs WHERE note_id=?').run(id);
      if(current)this.db.prepare('DELETE FROM note_embeddings WHERE revision_id IN (SELECT id FROM note_revisions WHERE note_id=?)').run(id);
      const saved=this.db.prepare('SELECT created_at,origin_kind,is_demo,ai_excluded,ai_access_version FROM notes WHERE id=?').get(id);
      if(body&&!saved.ai_excluded&&saved.origin_kind==='human'&&!saved.is_demo&&this.autoClassifyEnabled()&&typeof input.model==='string'&&input.model){
        // Every saved note is read once: sorted into categories (when there are any), its link read,
        // and what it says added to the memory layer.
        this.db.prepare(`INSERT INTO classification_jobs(note_id,revision_id,model,updated_at,token) VALUES(?,?,?,?,?)
          ON CONFLICT(note_id) DO UPDATE SET revision_id=excluded.revision_id,model=excluded.model,state='pending',attempts=0,last_error=NULL,retry_after=NULL,token=excluded.token,updated_at=excluded.updated_at,facts_only=0,facts_read=0`).run(id,revisionId,input.model,now,randomUUID());
      }
      if(input.draftClearedAt!==undefined){
        const clearedAt=Number(input.draftClearedAt);
        if(!Number.isSafeInteger(clearedAt)||clearedAt<=0)throw new Error('Invalid draft timestamp.');
        this.writeDraftSnapshot({text:'',originKind:'human',sourceKind:'unspecified',editingId:'',updatedAt:Math.max(clearedAt,this.draftUpdatedAt()+1)});
      }
      return {id,revisionId,text:body,date:saved.created_at,originKind:saved.origin_kind,isDemo:!!saved.is_demo,aiExcluded:!!saved.ai_excluded,aiAccessVersion:saved.ai_access_version,sourceKind,sourceUrl,excerpt,sourceTitle,sourceApp,attachments:this.attachmentsFor(id)};
    });
  }
  // A note that leaves the list is no longer what the draft edits; the typed text stays as a new note.
  detachDraftFrom(id){if(this.draftEditing()===id)this.draftEditing('');}
  trashNote(id) {
    return this.tx(() => {
      const changed=this.db.prepare('UPDATE notes SET deleted_at=? WHERE id=? AND deleted_at IS NULL').run(new Date().toISOString(),id);
      if(!changed.changes)throw new Error('Active note not found.');
      this.detachDraftFrom(id);
      this.db.prepare(`WITH RECURSIVE impacted(id) AS (
        SELECT ai.run_id FROM analysis_inputs ai JOIN note_revisions r ON r.id=ai.revision_id WHERE r.note_id=?
        UNION SELECT o.run_id FROM evidence e JOIN outputs o ON o.id=e.output_id JOIN note_revisions r ON r.id=e.revision_id WHERE r.note_id=?
        UNION SELECT rc.run_id FROM run_contexts rc JOIN impacted i ON rc.source_run_id=i.id
      ) UPDATE outputs SET status='stale' WHERE run_id IN (SELECT id FROM impacted)`).run(id,id);
      this.db.prepare('DELETE FROM classification_jobs WHERE note_id=?').run(id);
      this.db.prepare('DELETE FROM note_embeddings WHERE revision_id IN (SELECT id FROM note_revisions WHERE note_id=?)').run(id);
    });
  }
  restoreNote(id) {
    return this.tx(() => {
      const changed=this.db.prepare('UPDATE notes SET deleted_at=NULL WHERE id=? AND deleted_at IS NOT NULL').run(id);
      if(!changed.changes)throw new Error('Trashed note not found.');
      return this.db.prepare(`SELECT n.id,n.current_revision_id AS revisionId,r.body AS text,r.excerpt AS excerpt,r.source_title AS sourceTitle,r.source_app AS sourceApp,
        n.created_at AS date,n.origin_kind AS originKind,n.is_demo AS isDemo,n.ai_excluded AS aiExcluded,n.ai_access_version AS aiAccessVersion,
        r.source_kind AS sourceKind,r.source_url AS sourceUrl
        FROM notes n JOIN note_revisions r ON r.id=n.current_revision_id WHERE n.id=?`).get(id);
    });
  }
  setAiExcluded({id,excluded,model,expectedAccessVersion}={}, {allowTrashed=false}={}){
    if(typeof id!=='string'||typeof excluded!=='boolean')throw new Error('AI解析の設定が不正です。');
    const changed=this.tx(()=>{
      const note=this.db.prepare('SELECT * FROM notes WHERE id=? AND (? OR deleted_at IS NULL)').get(id,allowTrashed?1:0);
      if(!note)throw new Error('メモが見つかりません。');
      if(expectedAccessVersion!==undefined&&expectedAccessVersion!==note.ai_access_version)throw new Error('設定が変更されました。メモを開き直してください。');
      if(!!note.ai_excluded===excluded)return false;
      this.db.prepare('UPDATE notes SET ai_excluded=?,ai_access_version=ai_access_version+1 WHERE id=?').run(excluded?1:0,id);
      this.db.prepare('DELETE FROM classification_jobs WHERE note_id=?').run(id);
      this.db.prepare('DELETE FROM note_embeddings WHERE revision_id IN (SELECT id FROM note_revisions WHERE note_id=?)').run(id);
      this.db.prepare('DELETE FROM link_readings WHERE revision_id IN (SELECT id FROM note_revisions WHERE note_id=?)').run(id);
      this.forgetNoteFacts(id);
      if(excluded)this.pruneNewsInterests(id);
      const affected=new Set(['all',...this.db.prepare('SELECT category_id AS id FROM assignments WHERE note_id=?').all(id).map(row=>row.id)]);
      if(excluded){
        // Old runs have no feedback lineage. Treat them conservatively; new runs
        // record context dependencies so exclusion also follows derived feedback.
        const impacted=this.db.prepare(`WITH RECURSIVE impacted(id) AS (
          SELECT id FROM runs WHERE context_tracked=0
          UNION SELECT ai.run_id FROM analysis_inputs ai JOIN note_revisions r ON r.id=ai.revision_id WHERE r.note_id=?
          UNION SELECT o.run_id FROM evidence e JOIN outputs o ON o.id=e.output_id JOIN note_revisions r ON r.id=e.revision_id WHERE r.note_id=?
          UNION SELECT rc.run_id FROM run_contexts rc JOIN impacted i ON rc.source_run_id=i.id
        ) SELECT r.id,r.category_id AS categoryId FROM runs r JOIN impacted i ON i.id=r.id WHERE r.ai_blocked=0`).all(id,id);
        for(const run of impacted){
          this.db.prepare('UPDATE runs SET ai_blocked=1 WHERE id=?').run(run.id);
          this.db.prepare("UPDATE outputs SET status='stale' WHERE run_id=?").run(run.id);
          affected.add(run.categoryId);
        }
      }
      for(const categoryId of affected){
        this.db.prepare("UPDATE outputs SET status='stale' WHERE category_id=? AND status='current' AND kind IN ('summary','pattern','action')").run(categoryId);
        this.db.prepare('DELETE FROM digest_jobs WHERE category_id=?').run(categoryId);
      }
      if(!excluded&&note.origin_kind==='human'&&!note.is_demo&&this.autoClassifyEnabled()&&typeof model==='string'&&model){
        const revision=this.db.prepare('SELECT body FROM note_revisions WHERE id=?').get(note.current_revision_id);
        if(revision.body.trim())this.db.prepare('INSERT INTO classification_jobs(note_id,revision_id,model,updated_at,token) VALUES(?,?,?,?,?)').run(id,note.current_revision_id,model,new Date().toISOString(),randomUUID());
      }
      return true;
    });
    if(changed)this.queueStaleDigests();
    return changed;
  }
  purgeNote(id) {
    const removed=this.tx(() => {
      if(!this.db.prepare('SELECT 1 FROM notes WHERE id=? AND deleted_at IS NOT NULL').get(id))throw new Error('Move the note to trash before deleting it permanently.');
      // Older analysis runs did not record every input. Any of them may contain a copy
      // of this note, including in outputs without an evidence link.
      const analysisCount=this.db.prepare('SELECT count(*) AS count FROM runs').get().count;
      for(const table of ['feedback','ask_questions','run_contexts','evidence','analysis_inputs','digest_claim_evidence','digest_claims','answer_claim_evidence','answer_claims','retrieval_items','outputs','runs'])this.db.exec(`DELETE FROM ${table}`);
      this.db.exec('DELETE FROM digest_jobs');
      this.db.prepare('DELETE FROM classification_jobs WHERE note_id=?').run(id);
      this.db.prepare('DELETE FROM note_embeddings WHERE revision_id IN (SELECT id FROM note_revisions WHERE note_id=?)').run(id);
      this.db.prepare('DELETE FROM assignment_exclusions WHERE note_id=?').run(id);
      this.db.prepare('DELETE FROM assignments WHERE note_id=?').run(id);
      this.db.prepare('DELETE FROM article_previews WHERE revision_id IN (SELECT id FROM note_revisions WHERE note_id=?)').run(id);
      this.db.prepare('DELETE FROM link_readings WHERE revision_id IN (SELECT id FROM note_revisions WHERE note_id=?)').run(id);
      this.forgetNoteFacts(id);
      this.db.prepare('DELETE FROM note_revisions WHERE note_id=?').run(id);
      this.detachDraftFrom(id);
      this.pruneNewsInterests(id);
      this.db.prepare('DELETE FROM attachments WHERE note_id=?').run(id);
      this.db.prepare('DELETE FROM notes WHERE id=?').run(id);
      this.db.prepare('INSERT INTO purged_notes(id,purged_at) VALUES(?,?) ON CONFLICT(id) DO NOTHING').run(id,new Date().toISOString());
      return {analysisCount};
    });
    // Flush older WAL pages and rebuild the live database to remove freed text pages.
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);');
    return removed;
  }
  purgedNoteIds(){return this.db.prepare('SELECT id FROM purged_notes').all().map(row=>row.id);}
  categories() { const rows=this.db.prepare("SELECT id,name FROM categories WHERE state='active' ORDER BY CASE WHEN id='all' THEN 0 ELSE 1 END,name").all();return [rows[0],{id:'other',name:'Other'},...rows.slice(1)]; }
  categoryOverview(){return this.categories().map(c=>({...c,count:this.notesFor(c.id).length}));}
  memoryContextCurrent(runId){
    return !this.db.prepare(`WITH RECURSIVE context(id) AS (
      SELECT ? UNION SELECT rc.source_run_id FROM run_contexts rc JOIN context c ON rc.run_id=c.id
    ) SELECT 1 FROM context c JOIN runs run ON run.id=c.id
      LEFT JOIN analysis_inputs ai ON ai.run_id=c.id
      LEFT JOIN note_revisions r ON r.id=ai.revision_id LEFT JOIN notes n ON n.id=r.note_id
      WHERE run.ai_blocked=1 OR (ai.revision_id IS NOT NULL AND (
        n.id IS NULL OR n.deleted_at IS NOT NULL OR n.current_revision_id!=ai.revision_id
        OR n.ai_excluded=1 OR n.origin_kind!='human' OR n.is_demo=1)) LIMIT 1`).get(runId);
  }
  memoryMapData(){
    const {localThemes}=require('./memory-map.cjs');
    const notes=this.listNotes().filter(n=>n.originKind==='human'&&!n.isDemo);
    const revisions=new Set(notes.filter(n=>!n.aiExcluded).map(n=>n.revisionId));
    const rows=this.db.prepare("SELECT o.* FROM outputs o JOIN runs r ON r.id=o.run_id WHERE o.kind='memory-theme' AND o.status='current' AND r.ai_blocked=0 ORDER BY o.rowid").all();
    const themes=rows.filter(row=>this.memoryContextCurrent(row.run_id)).map(row=>{
      const body=JSON.parse(row.text),rating=this.inflateOutput(row).rating;
      return {...body,id:row.id,origin:'ai',state:rating?.rating==='good'?'confirmed':rating?.rating==='bad'?(rating.reason==='memory-hide'?'hidden':'corrected'):'unreviewed',correction:rating?.rating==='bad'?rating.comment:'',date:row.created_at};
    }).filter(t=>t.evidence.every(e=>revisions.has(e.revisionId)));
    const latest=this.db.prepare("SELECT r.created_at,(SELECT count(*) FROM analysis_inputs WHERE run_id=r.id) AS sampleCount FROM runs r WHERE r.purpose='memory' AND r.ai_blocked=0 ORDER BY r.rowid DESC LIMIT 1").get();
    return {notes,total:notes.length,themes:themes.filter(t=>t.state!=='hidden'),hiddenThemes:themes.filter(t=>t.state==='hidden'),localThemes:localThemes(notes),analysisAt:latest?.created_at||null,sampleCount:latest?.sampleCount||0,eligibleCount:notes.filter(n=>!n.aiExcluded&&n.text.trim()).length};
  }
  saveMemoryThemes({items,result,model,contextRunIds=[],promptVersion='memory-1'}){
    const {validateThemes}=require('./memory-map.cjs');
    const themes=validateThemes(result,items);
    this.assertAiSnapshot(items,contextRunIds);
    this.tx(()=>{
      const runId=randomUUID(),now=new Date().toISOString();
      this.db.prepare("UPDATE outputs SET status='superseded' WHERE kind='memory-theme' AND status='current'").run();
      this.db.prepare("INSERT INTO runs(id,purpose,category_id,model,prompt_version,created_at,context_tracked) VALUES(?,'memory','all',?,?,?,1)").run(runId,model,promptVersion,now);
      for(const source of new Set(contextRunIds))this.db.prepare('INSERT INTO run_contexts(run_id,source_run_id) VALUES(?,?)').run(runId,source);
      for(const item of items)this.db.prepare('INSERT INTO analysis_inputs(run_id,revision_id) VALUES(?,?)').run(runId,item.revisionId);
      for(const theme of themes){
        const id=randomUUID();
        this.db.prepare("INSERT INTO outputs(id,run_id,kind,text,category_id,created_at) VALUES(?,?,'memory-theme',?,'all',?)").run(id,runId,JSON.stringify(theme),now);
        for(const e of theme.evidence)this.db.prepare('INSERT INTO evidence(output_id,revision_id) VALUES(?,?)').run(id,e.revisionId);
      }
    });return this.memoryMapData();
  }
  reviewMemoryTheme({id,decision,comment=''}){
    const theme=this.memoryMapData().themes.concat(this.memoryMapData().hiddenThemes).find(t=>t.id===id&&t.origin==='ai');
    if(!theme)throw Error('原文が変わりました。地図を更新してください。');
    if(!['confirm','correct','hide','reset'].includes(decision))throw Error('確認の形式が不正です。');
    if(decision==='correct'&&(!String(comment).trim()||String(comment).length>500))throw Error('訂正を1〜500文字で入力してください。');
    this.rate(id,decision==='confirm'?'good':decision==='reset'?'clear':'bad',`memory-${decision}`,decision==='correct'?String(comment).trim():'');
    return this.memoryMapData();
  }
  memoryFeedbackFor(question=''){
    const rows=this.db.prepare("SELECT o.*,f.rating,f.reason,f.comment FROM outputs o JOIN runs r ON r.id=o.run_id JOIN feedback f ON f.output_id=o.id WHERE o.kind='memory-theme' AND o.status!='stale' AND r.ai_blocked=0 AND f.id=(SELECT id FROM feedback WHERE output_id=o.id ORDER BY created_at DESC,rowid DESC LIMIT 1) ORDER BY f.created_at DESC,f.rowid DESC LIMIT 60").all();
    const current=new Set(this.searchableNotes().map(n=>n.revisionId));
    const seen=new Set();
    const latest=rows.filter(r=>this.memoryContextCurrent(r.run_id)&&JSON.parse(r.text).evidence.every(e=>current.has(e.revisionId))).map(r=>({theme:JSON.parse(r.text).label,description:JSON.parse(r.text).description,rating:r.rating,reason:r.reason,comment:r.comment,_runId:r.run_id})).filter(r=>{if(seen.has(r.theme))return false;seen.add(r.theme);return r.rating!=='clear'});
    const grams=text=>{const cleaned=String(text).toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');return new Set(Array.from({length:Math.max(0,cleaned.length-1)},(_,i)=>cleaned.slice(i,i+2)))};
    const wanted=grams(question);
    return latest.filter(r=>!question||[r.theme,r.comment].some(text=>{const other=grams(text);const shared=[...other].filter(g=>wanted.has(g)).length;return shared>0&&shared/Math.max(1,Math.min(other.size,wanted.size))>=.3})).slice(0,8);
  }
  graphData(limit=160){
    const size=Math.max(1,Math.min(300,Number(limit)||160));
    const total=this.db.prepare("SELECT count(*) AS count FROM notes WHERE deleted_at IS NULL AND origin_kind='human' AND is_demo=0").get().count;
    const rows=this.db.prepare(`WITH recent AS (
      SELECT n.id,n.current_revision_id AS revisionId,n.created_at AS date,r.body AS text,r.excerpt AS excerpt,r.source_title AS sourceTitle,r.source_app AS sourceApp
      FROM notes n JOIN note_revisions r ON r.id=n.current_revision_id
      WHERE n.deleted_at IS NULL AND n.origin_kind='human' AND n.is_demo=0
      ORDER BY n.created_at DESC,n.id DESC LIMIT ?
    ) SELECT recent.id,recent.revisionId,recent.date,recent.text,
      c.id AS categoryId,c.name AS categoryName,a.origin
      FROM recent LEFT JOIN assignments a ON a.note_id=recent.id AND a.revision_id=recent.revisionId
      LEFT JOIN categories c ON c.id=a.category_id AND c.state='active' AND c.id!='all'
      ORDER BY recent.date DESC,recent.id DESC`).all(size);
    const notes=new Map();
    for(const row of rows){
      let note=notes.get(row.id);
      if(!note){note={id:row.id,revisionId:row.revisionId,date:row.date,text:row.text,categories:[]};notes.set(row.id,note);}
      if(row.categoryId)note.categories.push({id:row.categoryId,name:row.categoryName,origin:row.origin});
    }
    const visible=[...notes.values()];
    const categoryIds=new Set(visible.flatMap(note=>note.categories.map(category=>category.id)));
    const categories=this.db.prepare("SELECT id,name FROM categories WHERE state='active' AND id!='all' ORDER BY name").all().filter(category=>categoryIds.has(category.id));
    if(visible.some(note=>!note.categories.length))categories.push({id:'other',name:'Other'});
    return {total,shown:visible.length,categories,notes:visible};
  }
  searchableNotes(){
    return this.withArticles(this.db.prepare(`SELECT n.id,n.current_revision_id AS revisionId,r.body AS text,r.excerpt AS excerpt,r.source_title AS sourceTitle,r.source_app AS sourceApp,r.created_at AS date,n.ai_excluded AS aiExcluded,n.ai_access_version AS aiAccessVersion,
      COALESCE(group_concat(c.name,' '),'') AS categoryNames,
      r.source_kind AS sourceKind,r.source_url AS sourceUrl
      FROM notes n JOIN note_revisions r ON r.id=n.current_revision_id
      LEFT JOIN assignments a ON a.note_id=n.id AND a.revision_id=n.current_revision_id
      LEFT JOIN categories c ON c.id=a.category_id AND c.state='active' AND c.id!='all'
      WHERE n.deleted_at IS NULL AND n.origin_kind='human' AND n.is_demo=0 AND n.ai_excluded=0 AND trim(r.body)!=''
      GROUP BY n.id ORDER BY r.created_at DESC,n.id DESC`).all());
  }
  searchableDigestClaims(){
    const rows=[];
    for(const {id,name} of this.db.prepare("SELECT id,name FROM categories WHERE state='active' AND id!='all'").all()){
      if(this.insightState(id).status!=='current')continue;
      const summary=this.db.prepare("SELECT run_id AS runId FROM outputs WHERE kind='summary' AND category_id=? AND status='current' ORDER BY created_at DESC,rowid DESC LIMIT 1").get(id);
      if(!summary)continue;
      for(const claim of this.db.prepare('SELECT id,text,created_at AS date FROM digest_claims WHERE run_id=? ORDER BY rowid').all(summary.runId)){
        const sourceRevisionIds=this.db.prepare(`SELECT DISTINCT e.revision_id AS revisionId FROM digest_claim_evidence e
          JOIN note_revisions r ON r.id=e.revision_id JOIN notes n ON n.id=r.note_id
          WHERE e.claim_id=? AND n.current_revision_id=e.revision_id AND n.deleted_at IS NULL
          AND n.origin_kind='human' AND n.is_demo=0 AND n.ai_excluded=0`).all(claim.id).map(row=>row.revisionId);
        if(sourceRevisionIds.length)rows.push({revisionId:claim.id,text:claim.text,date:claim.date,categoryNames:name,sourceRevisionIds});
      }
    }
    return rows;
  }
  askDigestEnabled(value){
    if(value===undefined)return this.db.prepare("SELECT value FROM app_state WHERE key='ask_digest'").get()?.value==='true';
    this.db.prepare("INSERT INTO app_state(key,value) VALUES('ask_digest',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(value?'true':'false');
    return !!value;
  }
  cachedEmbeddings(model){
    return new Map(this.db.prepare('SELECT revision_id AS revisionId,vector FROM note_embeddings WHERE model=?').all(model).map(row=>{
      const bytes=Buffer.from(row.vector),values=[];for(let offset=0;offset<bytes.length;offset+=4)values.push(bytes.readFloatLE(offset));
      return [row.revisionId,values];
    }));
  }
  saveEmbeddings(model,items){
    this.tx(()=>{for(const item of items){
      if(!this.db.prepare('SELECT 1 FROM notes WHERE current_revision_id=? AND deleted_at IS NULL AND ai_excluded=0 AND ai_access_version=?').get(item.revisionId,item.aiAccessVersion??0))continue;
      const vector=Buffer.alloc(item.vector.length*4);
      item.vector.forEach((value,index)=>vector.writeFloatLE(value,index*4));
      this.db.prepare('INSERT INTO note_embeddings(revision_id,model,vector) VALUES(?,?,?) ON CONFLICT(revision_id) DO UPDATE SET model=excluded.model,vector=excluded.vector').run(item.revisionId,model,vector);
    }});
  }
  // The newest capture from this page, for appending within a few minutes.
  recentCaptureFor(url){
    if(!url)return null;
    return this.db.prepare(`SELECT n.id,r.body AS text,r.excerpt,r.source_kind AS sourceKind,r.source_url AS sourceUrl,r.source_title AS sourceTitle,r.source_app AS sourceApp,r.created_at AS date
      FROM notes n JOIN note_revisions r ON r.id=n.current_revision_id
      WHERE n.deleted_at IS NULL AND n.origin_kind='human' AND r.source_url=?
      ORDER BY r.created_at DESC LIMIT 1`).get(url)||null;
  }
  // Apps whose selection is never read by quick capture (names or bundle IDs).
  captureExcluded(value){
    if(value===undefined){try{return JSON.parse(this.db.prepare("SELECT value FROM app_state WHERE key='capture_excluded'").get()?.value||'[]')}catch{return []}}
    if(!Array.isArray(value)||value.length>50||value.some(item=>typeof item!=='string'||item.length>120))throw new Error('Invalid excluded apps.');
    const list=[...new Set(value.map(item=>item.trim()).filter(Boolean))];
    this.db.prepare("INSERT INTO app_state(key,value) VALUES('capture_excluded',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(list));
    return list;
  }
  // Reasoning effort for every Codex turn ('' = each model's default).
  // Which AI runs pure.'s work, and the model for light work ('' = the chosen model, low effort).
  aiSettings(value){
    const get=key=>this.db.prepare('SELECT value FROM app_state WHERE key=?').get(key)?.value;
    const set=(key,v)=>this.db.prepare('INSERT INTO app_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,v);
    if(value?.provider!==undefined){if(!['codex','claude'].includes(value.provider))throw new Error('Unknown AI provider.');set('ai_provider',value.provider);}
    if(value?.lightModel!==undefined){if(typeof value.lightModel!=='string'||value.lightModel.length>120)throw new Error('Invalid model.');set('ai_light_model',value.lightModel);}
    return {provider:get('ai_provider')==='claude'?'claude':'codex',lightModel:get('ai_light_model')||''};
  }
  logAiCall(call){
    this.db.prepare(`INSERT INTO ai_calls(provider,at,purpose,prompt_version,model,effort,ms,input_tokens,cached_input_tokens,output_tokens,reasoning_tokens,status,error)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(call.provider==='claude'?'claude':'codex',new Date().toISOString(),String(call.purpose||'unknown'),String(call.promptVersion||''),String(call.model||''),call.effort||null,
      Math.max(0,Math.round(call.ms||0)),call.usage?.input??null,call.usage?.cachedInput??null,call.usage?.output??null,call.usage?.reasoning??null,call.status==='ok'?'ok':call.status==='cancelled'?'cancelled':'error',String(call.error||'').slice(0,300));
    this.db.exec('DELETE FROM ai_calls WHERE id<=(SELECT id FROM ai_calls ORDER BY id DESC LIMIT 1 OFFSET 2000)');
  }
  aiCalls(limit=200){return this.db.prepare('SELECT * FROM ai_calls ORDER BY id DESC LIMIT ?').all(limit);}
  // pure.'s own AI use since a time, by provider and purpose (light tasks' retries count as their task).
  aiUsage(since){
    const rows=this.db.prepare(`SELECT provider,purpose,count(*) AS calls,sum(status!='ok') AS errors,sum(ms) AS ms,COALESCE(sum(input_tokens),0) AS input,COALESCE(sum(COALESCE(output_tokens,0)+COALESCE(reasoning_tokens,0)),0) AS output
      FROM ai_calls WHERE at>=? GROUP BY provider,purpose`).all(since);
    const total=rows.reduce((sum,row)=>({calls:sum.calls+row.calls,errors:sum.errors+row.errors,ms:sum.ms+row.ms,input:sum.input+row.input,output:sum.output+row.output}),{calls:0,errors:0,ms:0,input:0,output:0});
    const byPurpose=new Map();
    for(const row of rows){const key=row.purpose.replace(/-retry$/,'');const entry=byPurpose.get(key)||{purpose:key,calls:0,errors:0,ms:0,input:0,output:0,providers:[]};
      for(const field of ['calls','errors','ms','input','output'])entry[field]+=row[field];if(!entry.providers.includes(row.provider))entry.providers.push(row.provider);byPurpose.set(key,entry);}
    const byProvider={};for(const row of rows)byProvider[row.provider]=(byProvider[row.provider]||0)+row.calls;
    return {...total,byProvider,byPurpose:[...byPurpose.values()].sort((a,b)=>b.input+b.output-(a.input+a.output))};
  }
  // The last usage windows Claude Code reported (it reports them only with an answer).
  claudeLimits(value){
    if(value===undefined){try{return JSON.parse(this.db.prepare("SELECT value FROM app_state WHERE key='claude_limits'").get()?.value||'null')}catch{return null}}
    this.db.prepare("INSERT INTO app_state(key,value) VALUES('claude_limits',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(value));
    return value;
  }
  // News settings: whether collection is on, and the exact words sent (topics).
  newsSettings(){
    const get=key=>this.db.prepare('SELECT value FROM app_state WHERE key=?').get(key)?.value;
    let topics=[];try{topics=JSON.parse(get('news_topics')||'[]')}catch{}
    let failures=[];try{failures=JSON.parse(get('news_failures')||'[]')}catch{}
    let blocked=[];try{blocked=JSON.parse(get('news_blocked')||'[]')}catch{}
    let lastTopics=[];try{lastTopics=JSON.parse(get('news_last_topics')||'[]')}catch{}
    return {enabled:get('news_enabled')==='true',topics:Array.isArray(topics)?topics:[],blocked:Array.isArray(blocked)?blocked:[],lastRunAt:get('news_last_run')||'',failures,lastTopics:Array.isArray(lastTopics)?lastTopics:[]};
  }
  // `blocked`: words found in the notes that the user took out; they are not sent again.
  setNewsSettings({enabled,topics,blocked}={}){
    const set=(key,value)=>this.db.prepare('INSERT INTO app_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);
    if(enabled!==undefined)set('news_enabled',enabled===true?'true':'false');
    if(topics!==undefined){
      if(!Array.isArray(topics)||topics.length>20)throw new Error('送る言葉は20個までです。');
      const seen=new Set();
      const clean=topics.map(topic=>({id:String(topic?.id||'').slice(0,40)||Math.random().toString(36).slice(2,10),query:String(topic?.query||'').replace(/\s+/g,' ').trim().slice(0,60),enabled:topic?.enabled!==false}))
        .filter(topic=>topic.query&&!seen.has(topic.query.toLocaleLowerCase())&&seen.add(topic.query.toLocaleLowerCase()));
      set('news_topics',JSON.stringify(clean));
    }
    if(blocked!==undefined){
      if(!Array.isArray(blocked))throw new Error('Invalid news words.');
      set('news_blocked',JSON.stringify([...new Set(blocked.map(word=>String(word||'').replace(/\s+/g,' ').trim().slice(0,60)).filter(Boolean))].slice(0,200)));
    }
    return this.newsSettings();
  }
  // Interests found in the notes (interests.cjs), each with quoted notes. Only evidence from notes
  // that are still current and open to AI is shown; an interest left without evidence is not.
  // `related`: things someone with these interests would likely want news about too (an AI guess,
  // each naming the interest it comes from).
  saveNewsInterests(items,{model='',locale='ja',fingerprint=this.interestFingerprint(),version='',related=[]}={}){
    this.db.prepare("INSERT INTO app_state(key,value) VALUES('news_interests',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(JSON.stringify({at:new Date().toISOString(),model,locale,fingerprint,version,items,related}));
    return this.newsInterests();
  }
  // Changes whenever the notes AI may read change, so interests are looked for again only then.
  interestFingerprint(){
    const row=this.db.prepare(`SELECT count(*) AS n,COALESCE(max(r.created_at),'') AS latest,COALESCE(sum(n.ai_access_version),0) AS access FROM notes n JOIN note_revisions r ON r.id=n.current_revision_id
      WHERE n.deleted_at IS NULL AND n.origin_kind='human' AND n.is_demo=0 AND n.ai_excluded=0`).get();
    const facts=this.db.prepare('SELECT count(*) AS n,COALESCE(max(id),0) AS last FROM memory_facts').get();
    return `${row.n}:${row.latest}:${row.access}:${facts.n}:${facts.last}`;
  }
  // The words a collection sends: the user's own, then those found in the notes, minus what was taken out.
  // The user's own words and the interests from the notes (up to `limit`), then related words (up to `related`).
  newsWords(limit=12,related=4){
    const settings=this.newsSettings(),blocked=new Set(settings.blocked.map(word=>word.toLocaleLowerCase())),interests=this.newsInterests();
    const seen=new Set(),fresh=word=>{const key=word.toLocaleLowerCase();if(blocked.has(key)||seen.has(key))return false;seen.add(key);return true;};
    const own=[...settings.topics.filter(topic=>topic.enabled).map(topic=>topic.query),...interests.items.map(item=>item.query)].filter(fresh).slice(0,limit);
    return [...own,...interests.related.map(item=>item.query).filter(fresh).slice(0,related)];
  }
  newsInterests(){
    let saved={};try{saved=JSON.parse(this.db.prepare("SELECT value FROM app_state WHERE key='news_interests'").get()?.value||'{}')}catch{}
    const live=this.db.prepare('SELECT 1 FROM notes WHERE id=? AND current_revision_id=? AND deleted_at IS NULL AND ai_excluded=0');
    const settings=this.newsSettings();
    const taken=new Set([...settings.topics.map(topic=>topic.query),...settings.blocked].map(word=>word.toLocaleLowerCase()));
    const items=(saved.items||[]).map(item=>({...item,evidence:(item.evidence||[]).filter(e=>live.get(e.noteId,e.revisionId))}))
      .filter(item=>item.evidence.length&&!taken.has(item.query.toLocaleLowerCase()));
    // A related word stays only while the interest it came from does.
    const sources=new Map(items.map(item=>[item.query,item.label]));
    const related=(saved.related||[]).filter(item=>sources.has(item.from)&&!taken.has(item.query.toLocaleLowerCase())).map(item=>({...item,fromLabel:sources.get(item.from)}));
    return {at:saved.at||'',locale:saved.locale||'',fingerprint:saved.fingerprint||'',version:saved.version||'',items,related};
  }
  // Quotes are note text: they go when the note is deleted or closed to AI.
  pruneNewsInterests(noteId){
    const row=this.db.prepare("SELECT value FROM app_state WHERE key='news_interests'").get();if(!row)return;
    let saved;try{saved=JSON.parse(row.value)}catch{return}
    saved.items=(saved.items||[]).map(item=>({...item,evidence:(item.evidence||[]).filter(e=>e.noteId!==noteId)})).filter(item=>item.evidence.length);
    saved.related=(saved.related||[]).filter(item=>saved.items.some(source=>source.query===item.from));
    this.db.prepare("UPDATE app_state SET value=? WHERE key='news_interests'").run(JSON.stringify(saved));
  }
  newsUnseen(items){const known=this.db.prepare('SELECT 1 FROM news_items WHERE url=? UNION SELECT 1 FROM news_left_out WHERE url=?');return items.filter(item=>!known.get(item.url,item.url));}
  // `topics`: each word searched in this run and how many new items it brought, so the page can say
  // when a word found nothing new.
  saveNewsItems(items,{locale='ja',failures=[],ranAt=new Date().toISOString(),keepDays=14,leftOut=[],topics=[]}={}){
    return this.tx(()=>{
      const insert=this.db.prepare(`INSERT INTO news_items(url,title,title_localized,locale,source,kind,via,topic,summary,discussion,published_at,fetched_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(url) DO NOTHING`);
      for(const item of items)insert.run(item.url,item.title,item.titleLocalized||'',locale,item.source||'',item.kind,item.via,item.topic,item.summary||'',item.discussion||'',item.publishedAt||'',ranAt);
      const left=this.db.prepare('INSERT INTO news_left_out(url,at) VALUES(?,?) ON CONFLICT(url) DO NOTHING');
      for(const url of leftOut)left.run(url,ranAt);
      const before=new Date(Date.parse(ranAt)-keepDays*86400000).toISOString();
      this.db.prepare('DELETE FROM news_items WHERE fetched_at<?').run(before);
      this.db.prepare('DELETE FROM news_left_out WHERE at<?').run(before);
      const set=(key,value)=>this.db.prepare('INSERT INTO app_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);
      set('news_last_run',ranAt);set('news_failures',JSON.stringify(failures.slice(0,10)));
      set('news_last_topics',JSON.stringify(topics.map(topic=>({topic,added:items.filter(item=>item.topic===topic).length}))));
      return items.length;
    });
  }
  newsItems(){
    return this.db.prepare(`SELECT url,title,title_localized AS titleLocalized,locale,source,kind,via,topic,summary,discussion,published_at AS publishedAt,fetched_at AS fetchedAt
      FROM news_items ORDER BY COALESCE(NULLIF(published_at,''),fetched_at) DESC LIMIT 300`).all();
  }
  // Only links pure. collected can be opened from the news page (the item or its discussion).
  newsUrl(url){const value=String(url||'');return this.db.prepare("SELECT url FROM news_items WHERE url=? UNION SELECT discussion FROM news_items WHERE discussion=? AND discussion!=''").get(value,value)?.url||null;}
  // The UI language, so summaries written in the background match it.
  uiLocale(value){
    if(value===undefined)return this.db.prepare("SELECT value FROM app_state WHERE key='ui_locale'").get()?.value==='en'?'en':'ja';
    const locale=value==='en'?'en':'ja';
    this.db.prepare("INSERT INTO app_state(key,value) VALUES('ui_locale',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(locale);
    return locale;
  }
  reasoningEffort(value){
    if(value===undefined)return this.db.prepare("SELECT value FROM app_state WHERE key='reasoning_effort'").get()?.value||'';
    if(typeof value!=='string'||(value&&!/^[a-z0-9_-]{1,32}$/.test(value)))throw new Error('Invalid reasoning effort.');
    this.db.prepare("INSERT INTO app_state(key,value) VALUES('reasoning_effort',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(value);
    return value;
  }
  autoClassifyEnabled(value){
    if(value===undefined)return this.db.prepare("SELECT value FROM app_state WHERE key='auto_classify'").get()?.value!=='false';
    this.db.prepare("INSERT INTO app_state(key,value) VALUES('auto_classify',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(value?'true':'false');
    return !!value;
  }
  autoDigestEnabled(value,model){
    if(value===undefined)return this.db.prepare("SELECT value FROM app_state WHERE key='auto_digest'").get()?.value==='true';
    if(value&&(!model||typeof model!=='string'))throw new Error('Select a model before enabling automatic insight updates.');
    this.tx(()=>{
      this.db.prepare("INSERT INTO app_state(key,value) VALUES('auto_digest',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(value?'true':'false');
      if(value)this.db.prepare("INSERT INTO app_state(key,value) VALUES('auto_digest_model',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(model);
    });
    return !!value;
  }
  digestModel(){return this.db.prepare("SELECT value FROM app_state WHERE key='auto_digest_model'").get()?.value||'';}
  setDigestModel(model){
    if(typeof model!=='string'||!model)throw new Error('Select a model.');
    this.tx(()=>{
      this.db.prepare("INSERT INTO app_state(key,value) VALUES('auto_digest_model',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(model);
      this.db.prepare("UPDATE digest_jobs SET model=? WHERE state='pending'").run(model);
    });
    return model;
  }
  // How automatic digests are paced (see queueStaleDigests); tests and simulations may set 0.
  digestPacing={quietMs:10*60*1000,intervalMs:6*60*60*1000};
  queueStaleDigests(){
    if(!this.autoDigestEnabled())return 0;
    const model=this.digestModel(),now=new Date().toISOString();
    let queued=0;
    this.tx(()=>{
      const categories=this.db.prepare("SELECT id FROM categories WHERE state='active' AND id!='all'").all();
      for(const {id} of categories){
        if(this.insightSourceIds(id).length<2||this.insightState(id).status==='current'){
          this.db.prepare('DELETE FROM digest_jobs WHERE category_id=?').run(id);
          continue;
        }
        const fingerprint=this.insightFingerprint(id);
        const existing=this.db.prepare('SELECT fingerprint FROM digest_jobs WHERE category_id=?').get(id);
        if(existing?.fingerprint===fingerprint)continue;
        // A category's first digest is made at once. Later ones wait until its notes have been quiet a
        // while and the last digest is old enough, so a day of notes is one update, not one per note.
        // A digest the person rated Bad (its latest rating) is redone at once.
        const {analyzedAt}=this.insightState(id),{quietMs,intervalMs}=this.digestPacing;
        const flagged=this.db.prepare(`SELECT f.rating FROM feedback f JOIN outputs o ON o.id=f.output_id WHERE o.category_id=? AND o.created_at=?
          ORDER BY f.created_at DESC LIMIT 1`).get(id,analyzedAt||'')?.rating==='bad';
        const due=analyzedAt&&!flagged?Math.max(Date.parse(analyzedAt)+intervalMs,Date.now()+quietMs):null;
        this.db.prepare(`INSERT INTO digest_jobs(category_id,fingerprint,model,updated_at,token,retry_after) VALUES(?,?,?,?,?,?)
          ON CONFLICT(category_id) DO UPDATE SET fingerprint=excluded.fingerprint,model=excluded.model,
          state='pending',attempts=0,last_error=NULL,retry_after=excluded.retry_after,token=excluded.token,updated_at=excluded.updated_at`).run(id,fingerprint,model,now,randomUUID(),due&&due>Date.now()?due:null);
        queued++;
      }
      this.db.prepare("DELETE FROM digest_jobs WHERE category_id NOT IN (SELECT id FROM categories WHERE state='active' AND id!='all')").run();
    });
    return queued;
  }
  digestStatus(){return this.db.prepare('SELECT state,count(*) AS count FROM digest_jobs GROUP BY state').all().reduce((status,row)=>({...status,[row.state]:row.count}),{pending:0,running:0,failed:0});}
  nextDigestJob(){return this.db.prepare(`SELECT j.category_id AS categoryId,j.fingerprint,j.model,j.token,j.attempts FROM digest_jobs j
    JOIN categories c ON c.id=j.category_id AND c.state='active' WHERE j.state='pending' AND (j.retry_after IS NULL OR j.retry_after<=?) ORDER BY j.updated_at LIMIT 1`).get(Date.now());}
  markDigestRunning(job){return this.db.prepare("UPDATE digest_jobs SET state='running',attempts=attempts+1,retry_after=NULL,updated_at=? WHERE category_id=? AND fingerprint=? AND token=? AND state='pending'").run(new Date().toISOString(),job.categoryId,job.fingerprint,job.token).changes===1;}
  digestJobStillRunning(job){return !!this.db.prepare("SELECT 1 FROM digest_jobs WHERE category_id=? AND fingerprint=? AND token=? AND state='running'").get(job.categoryId,job.fingerprint,job.token);}
  finishDigest(job){this.db.prepare("DELETE FROM digest_jobs WHERE category_id=? AND fingerprint=? AND token=? AND state='running'").run(job.categoryId,job.fingerprint,job.token);}
  failDigest(job,error){this.failJob('digest',job.categoryId,job.token,error);}
  deferDigest(job){this.db.prepare("UPDATE digest_jobs SET state='pending',token=lower(hex(randomblob(16))),updated_at=? WHERE category_id=? AND fingerprint=? AND token=? AND state='running'").run(new Date().toISOString(),job.categoryId,job.fingerprint,job.token);}
  retryDigests(){this.db.prepare("UPDATE digest_jobs SET state='pending',attempts=0,last_error=NULL,retry_after=NULL,token=lower(hex(randomblob(16))),updated_at=? WHERE state='failed'").run(new Date().toISOString());}
  invalidateInsight(categoryId){
    this.db.prepare("UPDATE outputs SET status='stale' WHERE category_id=? AND kind IN ('summary','pattern','action') AND status='current'").run(categoryId);
  }
  classificationStatus(){return this.db.prepare("SELECT state,count(*) AS count FROM classification_jobs GROUP BY state").all().reduce((status,row)=>({...status,[row.state]:row.count}),{pending:0,running:0,failed:0});}
  // A note whose link is still being read waits up to 45 seconds, so sorting can use the page.
  // Notes without a link are read several at a time (one AI call); a note with a link is read alone,
  // with its page. Batches never mix sorting jobs with facts-only jobs or different models.
  // Reading older notes into memory only (no sorting) takes larger batches.
  nextClassificationJobs(limit=6,factsOnlyLimit=20){
    const first=this.nextClassificationJob();
    if(first?.factsOnly)limit=factsOnlyLimit;
    if(!first||limit<=1)return first?[first]:[];
    const more=this.db.prepare(`SELECT j.note_id AS noteId,j.revision_id AS revisionId,j.model,j.token,j.attempts,j.facts_only AS factsOnly,n.ai_access_version AS aiAccessVersion,r.body AS text,r.excerpt AS excerpt,r.source_title AS sourceTitle,r.source_app AS sourceApp,
      n.created_at AS date,r.source_kind AS sourceKind,r.source_url AS sourceUrl FROM classification_jobs j JOIN notes n ON n.id=j.note_id
      JOIN note_revisions r ON r.id=j.revision_id WHERE j.state='pending' AND (j.retry_after IS NULL OR j.retry_after<=?) AND j.note_id!=?
      AND n.deleted_at IS NULL AND n.current_revision_id=j.revision_id AND n.origin_kind='human' AND n.is_demo=0 AND n.ai_excluded=0
      AND NOT EXISTS (SELECT 1 FROM article_previews ap WHERE ap.revision_id=j.revision_id AND ap.status IN ('pending','running') AND j.updated_at>?)
      AND j.model=? AND j.facts_only=? ORDER BY j.updated_at LIMIT ?`).all(Date.now(),first.noteId,new Date(Date.now()-45000).toISOString(),first.model,first.factsOnly,limit-1);
    // Notes with links go in the same batch; their pages are read with them.
    return [first,...this.withArticles(more)];
  }
  nextClassificationJob(){
    const job=this.db.prepare(`SELECT j.note_id AS noteId,j.revision_id AS revisionId,j.model,j.token,j.attempts,j.facts_only AS factsOnly,n.ai_access_version AS aiAccessVersion,r.body AS text,r.excerpt AS excerpt,r.source_title AS sourceTitle,r.source_app AS sourceApp,
      n.created_at AS date,r.source_kind AS sourceKind,r.source_url AS sourceUrl FROM classification_jobs j JOIN notes n ON n.id=j.note_id
      JOIN note_revisions r ON r.id=j.revision_id WHERE j.state='pending' AND (j.retry_after IS NULL OR j.retry_after<=?)
      AND n.deleted_at IS NULL AND n.current_revision_id=j.revision_id AND n.origin_kind='human' AND n.is_demo=0 AND n.ai_excluded=0
      AND NOT EXISTS (SELECT 1 FROM article_previews ap WHERE ap.revision_id=j.revision_id AND ap.status IN ('pending','running') AND j.updated_at>?)
      ORDER BY j.facts_only,j.updated_at LIMIT 1`).get(Date.now(),new Date(Date.now()-45000).toISOString());
    return job?this.withArticles([job])[0]:job;
  }
  markClassificationRunning(noteId,revisionId,token){
    token??=this.db.prepare('SELECT token FROM classification_jobs WHERE note_id=? AND revision_id=?').get(noteId,revisionId)?.token;
    return this.db.prepare("UPDATE classification_jobs SET state='running',attempts=attempts+1,retry_after=NULL,updated_at=? WHERE note_id=? AND revision_id=? AND token=? AND state='pending'").run(new Date().toISOString(),noteId,revisionId,token||'').changes===1;
  }
  failClassification(noteId,revisionId,error,token){this.failJob('classification',noteId,token,error);}
  deferClassification(noteId,revisionId,token){this.db.prepare("UPDATE classification_jobs SET state='pending',token=lower(hex(randomblob(16))),updated_at=? WHERE note_id=? AND revision_id=? AND token=? AND state='running'").run(new Date().toISOString(),noteId,revisionId,token);}
  retryClassifications(){this.db.prepare("UPDATE classification_jobs SET state='pending',attempts=0,last_error=NULL,retry_after=NULL,token=lower(hex(randomblob(16))),updated_at=? WHERE state='failed'").run(new Date().toISOString());}
  jobTable(kind){
    if(kind==='classification')return {table:'classification_jobs',key:'note_id',enabled:this.autoClassifyEnabled()};
    if(kind==='digest')return {table:'digest_jobs',key:'category_id',enabled:this.autoDigestEnabled()};
    throw new Error('不明なAI処理です。');
  }
  failJob(kind,id,token,error){
    const {table,key}=this.jobTable(kind);
    const job=this.db.prepare(`SELECT attempts FROM ${table} WHERE ${key}=? AND token=? AND state='running'`).get(id,token);
    if(!job)return false;
    const delay=retryDelay(error,job.attempts);
    this.db.prepare(`UPDATE ${table} SET state=?,last_error=?,retry_after=?,updated_at=? WHERE ${key}=? AND token=? AND state='running'`)
      .run(delay===null?'failed':'pending',String(error?.message||error).slice(0,300),delay===null?null:Date.now()+delay,new Date().toISOString(),id,token);
    return true;
  }
  nextJobDelay(kind){
    const jobs=this.processingJobs().filter(job=>job.kind===kind&&job.state==='pending'&&job.enabled);
    return jobs.length?Math.max(0,Math.min(...jobs.map(job=>job.retryAfter||0))-Date.now()):null;
  }
  processingJobs(){
    const classification=this.db.prepare(`SELECT 'classification' AS kind,j.note_id AS id,j.token,j.state,j.attempts,j.last_error AS error,j.retry_after AS retryAfter,j.updated_at AS updatedAt,j.model,r.body AS title
      FROM classification_jobs j JOIN notes n ON n.id=j.note_id JOIN note_revisions r ON r.id=j.revision_id
      WHERE j.state!='done' AND n.deleted_at IS NULL AND n.current_revision_id=j.revision_id AND n.origin_kind='human' AND n.is_demo=0 AND n.ai_excluded=0`).all();
    const digests=this.db.prepare(`SELECT 'digest' AS kind,j.category_id AS id,j.token,j.state,j.attempts,j.last_error AS error,j.retry_after AS retryAfter,j.updated_at AS updatedAt,j.model,c.name AS title
      FROM digest_jobs j JOIN categories c ON c.id=j.category_id WHERE c.state='active'`).all();
    const priority={running:0,pending:1,failed:2,cancelled:3};
    return [...classification,...digests].map(job=>({...job,title:job.title.slice(0,180),enabled:job.kind==='classification'?this.autoClassifyEnabled():this.autoDigestEnabled()}))
      .sort((a,b)=>priority[a.state]-priority[b.state]||b.updatedAt.localeCompare(a.updatedAt));
  }
  updateProcessingJob({kind,id,token,action}={}){
    const {table,key,enabled}=this.jobTable(kind);
    if(typeof id!=='string'||typeof token!=='string'||!['cancel','retry'].includes(action))throw new Error('AI処理の操作が不正です。');
    if(action==='retry'&&!enabled)throw new Error('再試行するには、この種類の自動処理をオンにしてください。');
    const now=new Date().toISOString();
    const result=action==='cancel'
      ?this.db.prepare(`UPDATE ${table} SET state='cancelled',retry_after=NULL,updated_at=? WHERE ${key}=? AND token=? AND state IN ('pending','running')`).run(now,id,token)
      :this.db.prepare(`UPDATE ${table} SET state='pending',attempts=0,last_error=NULL,retry_after=NULL,token=?,updated_at=? WHERE ${key}=? AND token=? AND state IN ('failed','cancelled')`).run(randomUUID(),now,id,token);
    return result.changes===1;
  }
  applyClassification(job,categoryIds,link=null,facts=null){
    return this.tx(()=>{
      const current=this.db.prepare("SELECT current_revision_id AS revisionId FROM notes WHERE id=? AND deleted_at IS NULL AND origin_kind='human' AND is_demo=0 AND ai_excluded=0").get(job.noteId);
      const queued=this.db.prepare('SELECT revision_id AS revisionId,state,token FROM classification_jobs WHERE note_id=?').get(job.noteId);
      if(current?.revisionId!==job.revisionId||queued?.revisionId!==job.revisionId||queued.state!=='running'||queued.token!==job.token)return false;
      if(facts){this.replaceMemoryFacts(job,facts);this.db.prepare('UPDATE classification_jobs SET facts_read=1 WHERE note_id=? AND revision_id=?').run(job.noteId,job.revisionId);}
      // A facts-only job (reading older notes into memory) leaves categories as they are.
      if(categoryIds===null){
        this.db.prepare("UPDATE classification_jobs SET state='done',last_error=NULL,updated_at=? WHERE note_id=? AND revision_id=?").run(new Date().toISOString(),job.noteId,job.revisionId);
        if(link)this.saveLinkReading(job,link);
        return true;
      }
      const selected=[...new Set(categoryIds)];
      if(selected.length>2)throw new Error('Too many categories in classification.');
      const active=this.db.prepare("SELECT id FROM categories WHERE state='active' AND id!='all'").all();
      const allowed=new Set(active.map(c=>c.id));
      if(selected.some(id=>!allowed.has(id)))throw new Error('AI returned an unknown or archived category.');
      const previous=this.db.prepare("SELECT category_id AS categoryId FROM assignments WHERE note_id=? AND origin='ai'").all(job.noteId).map(row=>row.categoryId);
      this.db.prepare("DELETE FROM assignments WHERE note_id=? AND origin='ai'").run(job.noteId);
      for(const categoryId of selected){
        if(this.db.prepare('SELECT 1 FROM assignment_exclusions WHERE note_id=? AND category_id=? AND revision_id=?').get(job.noteId,categoryId,job.revisionId))continue;
        this.db.prepare(`INSERT INTO assignments(note_id,category_id,revision_id,origin) VALUES(?,?,?,'ai')
          ON CONFLICT(note_id,category_id) DO NOTHING`).run(job.noteId,categoryId,job.revisionId);
      }
      this.db.prepare("UPDATE classification_jobs SET state='done',last_error=NULL,updated_at=? WHERE note_id=? AND revision_id=?").run(new Date().toISOString(),job.noteId,job.revisionId);
      if(link)this.saveLinkReading(job,link);
      for(const categoryId of new Set([...previous,...selected]))this.db.prepare("UPDATE outputs SET status='stale' WHERE category_id=? AND kind IN ('summary','pattern','action') AND status='current'").run(categoryId);
      return true;
    });
  }
  saveLinkReading(job,link){
    this.db.prepare(`INSERT INTO link_readings(revision_id,kind,title,creator,intent,summary,locale,model,created_at) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(revision_id) DO UPDATE SET kind=excluded.kind,title=excluded.title,creator=excluded.creator,intent=excluded.intent,summary=excluded.summary,locale=excluded.locale,model=excluded.model,created_at=excluded.created_at`)
      .run(job.revisionId,link.kind,link.title,link.creator,link.intent,link.summary,link.locale||'ja',job.model||'',new Date().toISOString());
  }
  replaceMemoryFacts(job,facts){
    this.db.prepare('DELETE FROM memory_facts WHERE note_id=?').run(job.noteId);
    const insert=this.db.prepare(`INSERT INTO memory_facts(note_id,revision_id,kind,subject,entity_type,statement,polarity,speaker,period,quote,model,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
    const now=new Date().toISOString();
    for(const fact of facts)insert.run(job.noteId,job.revisionId,fact.kind,fact.subject,fact.entityType,fact.statement,fact.polarity,fact.speaker,fact.period||'',fact.quote,job.model||'',now);
  }
  profileEntries(){
    return this.db.prepare('SELECT key,label,line,status,entity_type AS entityType,mentions,first_at AS first,latest_at AS latest,score,fact_ids AS factIds,locale,updated_at AS updatedAt FROM memory_profile ORDER BY score DESC')
      .all().map(row=>({...row,factIds:JSON.parse(row.factIds)}));
  }
  saveProfileEntries(entries){
    const upsert=this.db.prepare(`INSERT INTO memory_profile(key,label,line,status,entity_type,mentions,first_at,latest_at,score,fact_ids,locale,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(key) DO UPDATE SET label=excluded.label,line=excluded.line,status=excluded.status,entity_type=excluded.entity_type,mentions=excluded.mentions,first_at=excluded.first_at,
      latest_at=excluded.latest_at,score=excluded.score,fact_ids=excluded.fact_ids,locale=excluded.locale,updated_at=excluded.updated_at`);
    const now=new Date().toISOString();
    this.tx(()=>{for(const e of entries)upsert.run(e.key,e.label,e.line,e.status,e.entityType||'other',e.mentions,e.first,e.latest,e.score,JSON.stringify(e.factIds),e.locale||'ja',now);});
  }
  deleteProfileEntries(keys){const remove=this.db.prepare('DELETE FROM memory_profile WHERE key=?');this.tx(()=>{for(const key of keys)remove.run(key);});}
  profileMeta(value){
    let meta={};try{meta=JSON.parse(this.db.prepare("SELECT value FROM app_state WHERE key='profile_meta'").get()?.value||'{}')}catch{}
    if(value===undefined)return meta;
    meta={...meta,...value};
    this.db.prepare("INSERT INTO app_state(key,value) VALUES('profile_meta',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(meta));
    return meta;
  }
  // A line built from a note's facts goes as soon as the note is closed to AI or deleted; the
  // next update writes it again from what is left.
  forgetNoteFacts(noteId){
    const ids=new Set(this.db.prepare('SELECT id FROM memory_facts WHERE note_id=?').all(noteId).map(row=>row.id));
    if(ids.size){
      const touched=this.db.prepare('SELECT key,fact_ids AS factIds FROM memory_profile').all().filter(row=>JSON.parse(row.factIds).some(id=>ids.has(id))).map(row=>row.key);
      for(const key of touched)this.db.prepare('DELETE FROM memory_profile WHERE key=?').run(key);
    }
    this.db.prepare('DELETE FROM memory_facts WHERE note_id=?').run(noteId);
  }
  // The memory layer as features read it: only facts from current revisions of notes open to AI.
  memoryFacts({noteIds=null}={}){
    const rows=this.db.prepare(`SELECT f.id,f.note_id AS noteId,f.revision_id AS revisionId,f.kind,f.subject,f.entity_type AS entityType,f.statement,f.polarity,f.speaker,f.period,f.quote,
      n.created_at AS date FROM memory_facts f JOIN notes n ON n.id=f.note_id AND n.current_revision_id=f.revision_id
      WHERE n.deleted_at IS NULL AND n.ai_excluded=0 AND n.origin_kind='human' AND n.is_demo=0 ORDER BY n.created_at DESC,f.id`).all();
    return noteIds?rows.filter(row=>noteIds.has(row.noteId)):rows;
  }
  // Older notes (saved before the memory layer, or while it was off) are read in once, in the
  // background, without touching their categories.
  // Notes already there that the memory layer has not read yet (oldest last).
  unreadForMemory(){
    return this.db.prepare(`SELECT n.id,n.current_revision_id AS revisionId,n.created_at AS createdAt FROM notes n JOIN note_revisions r ON r.id=n.current_revision_id
      WHERE n.deleted_at IS NULL AND n.origin_kind='human' AND n.is_demo=0 AND n.ai_excluded=0 AND trim(r.body||r.excerpt)!=''
      AND NOT EXISTS (SELECT 1 FROM memory_facts f WHERE f.revision_id=n.current_revision_id)
      AND NOT EXISTS (SELECT 1 FROM classification_jobs j WHERE j.note_id=n.id AND j.revision_id=n.current_revision_id AND (j.state IN ('pending','running','failed','cancelled') OR (j.state='done' AND j.facts_read=1)))
      ORDER BY n.created_at DESC`).all();
  }
  // What the person chose for reading many notes at once: 'all', 'recent' (the last year) or 'later'.
  backfillDecision(value){
    if(value===undefined)return this.db.prepare("SELECT value FROM app_state WHERE key='memory_backfill_decision'").get()?.value||'';
    if(!['','all','recent','later'].includes(value))throw new Error('Invalid choice.');
    this.db.prepare("INSERT INTO app_state(key,value) VALUES('memory_backfill_decision',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(value);
    return value;
  }
  memoryBackfillPlan(now=Date.now()){
    const unread=this.unreadForMemory(),since=new Date(now-BACKFILL_RECENT_DAYS*86400000).toISOString();
    const decision=this.backfillDecision();
    return {unread:unread.length,recent:unread.filter(note=>note.createdAt>=since).length,decision,
      needsDecision:this.autoClassifyEnabled()&&unread.length>BACKFILL_ASK_OVER&&!decision,askOver:BACKFILL_ASK_OVER};
  }
  // Older notes are read in the background. Up to a few hundred are read without asking; more wait
  // for the person to choose all, the last year, or later, since it uses their AI account for a while.
  queueMemoryBackfill(model){
    if(typeof model!=='string'||!model||!this.autoClassifyEnabled())return 0;
    let rows=this.unreadForMemory();
    if(!rows.length)return 0;
    const decision=this.backfillDecision();
    if(decision==='later'||(rows.length>BACKFILL_ASK_OVER&&!decision))return 0;
    if(decision==='recent'){const since=new Date(Date.now()-BACKFILL_RECENT_DAYS*86400000).toISOString();rows=rows.filter(row=>row.createdAt>=since);}
    // Newest first: the queue goes by time, so each older note is queued a moment later.
    const start=Date.now();
    const upsert=this.db.prepare(`INSERT INTO classification_jobs(note_id,revision_id,model,updated_at,token,facts_only) VALUES(?,?,?,?,lower(hex(randomblob(16))),1)
      ON CONFLICT(note_id) DO UPDATE SET revision_id=excluded.revision_id,model=excluded.model,state='pending',attempts=0,last_error=NULL,retry_after=NULL,token=excluded.token,updated_at=excluded.updated_at,facts_only=1,facts_read=0`);
    this.tx(()=>{rows.forEach((row,index)=>upsert.run(row.id,row.revisionId,model,new Date(start+index).toISOString()));});
    return rows.length;
  }

  archivedCategories(){return this.db.prepare("SELECT id,name FROM categories WHERE state='archived' ORDER BY name").all();}
  categoryMerges(){return this.db.prepare(`SELECT t.id,t.source_category_id AS sourceId,t.target_category_id AS targetId,
    s.name AS sourceName,d.name AS targetName,t.moved_count AS movedCount,t.skipped_count AS skippedCount,
    t.created_at AS createdAt FROM category_transitions t
    JOIN categories s ON s.id=t.source_category_id JOIN categories d ON d.id=t.target_category_id
    WHERE t.kind='merge' ORDER BY t.created_at DESC,t.rowid DESC`).all();}
  categorySplits(){return this.db.prepare(`SELECT t.id,t.source_category_id AS sourceId,t.target_category_id AS targetId,
    s.name AS sourceName,d.name AS targetName,t.moved_count AS movedCount,t.created_at AS createdAt
    FROM category_transitions t JOIN categories s ON s.id=t.source_category_id
    JOIN categories d ON d.id=t.target_category_id
    WHERE t.kind='split' ORDER BY t.created_at DESC,t.rowid DESC`).all();}
  createCategory(name,noteIds=[]) {
    const label=String(name||'').trim().slice(0,60);
    if(!label||['all notes','other'].includes(label.toLocaleLowerCase())||!Array.isArray(noteIds))throw new Error('Choose a category name.');
    return this.tx(()=>{
      if(this.db.prepare("SELECT id FROM categories WHERE lower(name)=lower(?) AND state='active'").get(label))throw new Error('Category name already exists.');
      const id=randomUUID(),now=new Date().toISOString();
      this.db.prepare('INSERT INTO categories(id,name,created_at) VALUES(?,?,?)').run(id,label,now);
      this.db.prepare('INSERT INTO category_revisions(id,category_id,name,origin,created_at) VALUES(?,?,?,?,?)').run(randomUUID(),id,label,'human',now);
      for(const noteId of [...new Set(noteIds)]) this.assignNoteInTransaction(noteId,id);
      return {id,name:label};
    });
  }
  assignNoteInTransaction(noteId,categoryId) {
    const note=this.db.prepare("SELECT current_revision_id AS revisionId FROM notes WHERE id=? AND deleted_at IS NULL AND origin_kind='human' AND is_demo=0 AND ai_excluded=0").get(noteId);
    if(!note)throw new Error('Source note not found.');
    this.db.prepare(`INSERT INTO assignments(note_id,category_id,revision_id,origin) VALUES(?,?,?,'human')
      ON CONFLICT(note_id,category_id) DO UPDATE SET revision_id=excluded.revision_id,origin='human'`).run(noteId,categoryId,note.revisionId);
    this.db.prepare('DELETE FROM assignment_exclusions WHERE note_id=? AND category_id=?').run(noteId,categoryId);
    this.db.prepare("UPDATE outputs SET status='stale' WHERE category_id=? AND kind IN ('summary','pattern','action') AND status='current'").run(categoryId);
  }
  assignNote(noteId,categoryId) {
    return this.tx(()=>{
      if(!this.db.prepare("SELECT id FROM categories WHERE id=? AND state='active' AND id!='all'").get(categoryId))throw new Error('Category not found.');
      this.assignNoteInTransaction(noteId,categoryId);
      return true;
    });
  }
  unassignNote(noteId,categoryId){
    return this.tx(()=>{
      const note=this.db.prepare("SELECT current_revision_id AS revisionId FROM notes WHERE id=? AND deleted_at IS NULL AND origin_kind='human' AND is_demo=0 AND ai_excluded=0").get(noteId);
      if(!note||!this.db.prepare("SELECT id FROM categories WHERE id=? AND state='active' AND id!='all'").get(categoryId))throw new Error('Note or category not found.');
      this.db.prepare('DELETE FROM assignments WHERE note_id=? AND category_id=?').run(noteId,categoryId);
      this.db.prepare(`INSERT INTO assignment_exclusions(note_id,category_id,revision_id,created_at) VALUES(?,?,?,?)
        ON CONFLICT(note_id,category_id) DO UPDATE SET revision_id=excluded.revision_id,created_at=excluded.created_at`).run(noteId,categoryId,note.revisionId,new Date().toISOString());
      this.db.prepare("UPDATE outputs SET status='stale' WHERE category_id=? AND kind IN ('summary','pattern','action') AND status='current'").run(categoryId);
      return true;
    });
  }
  archiveCategory(id){
    return this.tx(()=>{
      if(id==='all'||!this.db.prepare("SELECT id FROM categories WHERE id=? AND state='active'").get(id))throw new Error('Category not found.');
      this.db.prepare("UPDATE categories SET state='archived' WHERE id=?").run(id);
      this.db.prepare("UPDATE outputs SET status='stale' WHERE category_id=? AND kind IN ('summary','pattern','action') AND status='current'").run(id);
      return true;
    });
  }
  mergeCategory(sourceId,targetId){
    return this.tx(()=>{
      if(!sourceId||!targetId||sourceId===targetId||sourceId==='all'||targetId==='all')throw new Error('Choose two different user categories.');
      const source=this.db.prepare("SELECT id,name FROM categories WHERE id=? AND state='active' AND id!='all'").get(sourceId);
      const target=this.db.prepare("SELECT id,name FROM categories WHERE id=? AND state='active' AND id!='all'").get(targetId);
      if(!source||!target)throw new Error('Both categories must be active.');
      const notes=this.db.prepare(`SELECT a.note_id AS noteId,a.revision_id AS revisionId
        FROM assignments a JOIN notes n ON n.id=a.note_id
        WHERE a.category_id=? AND a.revision_id=n.current_revision_id
        AND n.deleted_at IS NULL AND n.origin_kind='human' AND n.is_demo=0`).all(sourceId);
      let moved=0,skipped=0;
      for(const note of notes){
        if(this.db.prepare('SELECT 1 FROM assignment_exclusions WHERE note_id=? AND category_id=? AND revision_id=?').get(note.noteId,targetId,note.revisionId)){
          skipped++;continue;
        }
        const existing=this.db.prepare('SELECT revision_id AS revisionId,origin FROM assignments WHERE note_id=? AND category_id=?').get(note.noteId,targetId);
        if(existing?.revisionId===note.revisionId){
          if(existing.origin==='ai')this.db.prepare("UPDATE assignments SET origin='human' WHERE note_id=? AND category_id=?").run(note.noteId,targetId);
          continue;
        }
        this.db.prepare(`INSERT INTO assignments(note_id,category_id,revision_id,origin)
          VALUES(?,?,?,'human') ON CONFLICT(note_id,category_id)
          DO UPDATE SET revision_id=excluded.revision_id,origin='human'`).run(note.noteId,targetId,note.revisionId);
        moved++;
      }
      const id=randomUUID(),now=new Date().toISOString();
      this.db.prepare("UPDATE categories SET state='merged' WHERE id=?").run(sourceId);
      this.db.prepare(`INSERT INTO category_transitions(id,kind,source_category_id,target_category_id,moved_count,skipped_count,created_at)
        VALUES(?,'merge',?,?,?,?,?)`).run(id,sourceId,targetId,moved,skipped,now);
      this.db.prepare("UPDATE outputs SET status='stale' WHERE category_id IN (?,?,'all') AND kind IN ('summary','pattern','action') AND status='current'").run(sourceId,targetId);
      this.db.prepare('DELETE FROM digest_jobs WHERE category_id=?').run(sourceId);
      this.db.prepare("UPDATE classification_jobs SET state='pending',attempts=0,last_error=NULL,retry_after=NULL,token=lower(hex(randomblob(16))),updated_at=? WHERE state IN ('pending','running')").run(now);
      return {id,sourceId,targetId,sourceName:source.name,targetName:target.name,movedCount:moved,skippedCount:skipped};
    });
  }
  splitCategory(sourceId,name,noteIds){
    const label=String(name||'').trim().slice(0,60);
    if(!sourceId||sourceId==='all'||!label||['all notes','other'].includes(label.toLocaleLowerCase())||!Array.isArray(noteIds))throw new Error('Choose a source category, name and notes.');
    const selected=[...new Set(noteIds)];
    if(!selected.length)throw new Error('Select at least one note to move.');
    return this.tx(()=>{
      const source=this.db.prepare("SELECT id,name FROM categories WHERE id=? AND state='active' AND id!='all'").get(sourceId);
      if(!source)throw new Error('Source category not found.');
      if(this.db.prepare("SELECT 1 FROM categories WHERE lower(name)=lower(?) AND state='active'").get(label))throw new Error('Category name already exists.');
      const current=this.notesFor(sourceId);
      const allowed=new Map(current.map(note=>[note.id,note]));
      if(selected.length>=current.length)throw new Error('Leave at least one note in the source category.');
      if(selected.some(id=>!allowed.has(id)))throw new Error('A selected note is no longer in this category.');
      const targetId=randomUUID(),id=randomUUID(),now=new Date().toISOString();
      this.db.prepare('INSERT INTO categories(id,name,created_at) VALUES(?,?,?)').run(targetId,label,now);
      this.db.prepare('INSERT INTO category_revisions(id,category_id,name,origin,created_at) VALUES(?,?,?,?,?)').run(randomUUID(),targetId,label,'human',now);
      for(const noteId of selected){
        const note=allowed.get(noteId);
        this.assignNoteInTransaction(noteId,targetId);
        this.db.prepare('DELETE FROM assignments WHERE note_id=? AND category_id=?').run(noteId,sourceId);
        this.db.prepare(`INSERT INTO assignment_exclusions(note_id,category_id,revision_id,created_at) VALUES(?,?,?,?)
          ON CONFLICT(note_id,category_id) DO UPDATE SET revision_id=excluded.revision_id,created_at=excluded.created_at`).run(noteId,sourceId,note.revisionId,now);
      }
      this.db.prepare(`INSERT INTO category_transitions(id,kind,source_category_id,target_category_id,moved_count,skipped_count,created_at)
        VALUES(?,'split',?,?,?,0,?)`).run(id,sourceId,targetId,selected.length,now);
      this.db.prepare("UPDATE outputs SET status='stale' WHERE category_id IN (?,'all') AND kind IN ('summary','pattern','action') AND status='current'").run(sourceId);
      this.db.prepare("UPDATE classification_jobs SET state='pending',attempts=0,last_error=NULL,retry_after=NULL,token=lower(hex(randomblob(16))),updated_at=? WHERE state IN ('pending','running')").run(now);
      return {id,sourceId,targetId,sourceName:source.name,targetName:label,movedCount:selected.length};
    });
  }
  restoreCategory(id){
    return this.tx(()=>{
      const category=this.db.prepare("SELECT name FROM categories WHERE id=? AND state='archived'").get(id);
      if(!category)throw new Error('Archived category not found.');
      if(this.db.prepare("SELECT id FROM categories WHERE lower(name)=lower(?) AND state='active'").get(category.name))throw new Error('An active category already has this name.');
      this.db.prepare("UPDATE categories SET state='active' WHERE id=?").run(id);
      return true;
    });
  }
  renameCategory(id,name) {
    const label=String(name||'').trim().slice(0,60);
    if(id==='all'||!label||['all notes','other'].includes(label.toLocaleLowerCase()))throw new Error('Invalid category name.');
    return this.tx(()=>{
      const category=this.db.prepare("SELECT id FROM categories WHERE id=? AND state='active'").get(id);
      if(!category)throw new Error('Category not found.');
      if(this.db.prepare("SELECT id FROM categories WHERE lower(name)=lower(?) AND id!=? AND state='active'").get(label,id))throw new Error('Category name already exists.');
      this.db.prepare('UPDATE categories SET name=? WHERE id=?').run(label,id);
      this.db.prepare('INSERT INTO category_revisions(id,category_id,name,origin,created_at) VALUES(?,?,?,?,?)').run(randomUUID(),id,label,'human',new Date().toISOString());
      this.db.prepare("UPDATE outputs SET status='stale' WHERE category_id IN (?, 'all') AND kind IN ('summary','pattern','action') AND status='current'").run(id);
      return {id,name:label};
    });
  }
  notesFor(categoryId) {
    if (categoryId==='all') return this.listNotes().filter(n=>n.originKind==='human'&&!n.isDemo);
    if (categoryId==='other') return this.db.prepare(`SELECT n.id,n.current_revision_id AS revisionId,r.body AS text,r.excerpt AS excerpt,r.source_title AS sourceTitle,r.source_app AS sourceApp,n.created_at AS date,
      n.origin_kind AS originKind,n.is_demo AS isDemo,n.ai_excluded AS aiExcluded,n.ai_access_version AS aiAccessVersion,r.source_kind AS sourceKind,r.source_url AS sourceUrl
      FROM notes n JOIN note_revisions r ON r.id=n.current_revision_id
      WHERE n.deleted_at IS NULL AND n.origin_kind='human' AND n.is_demo=0
      AND NOT EXISTS (SELECT 1 FROM assignments a JOIN categories c ON c.id=a.category_id
        WHERE a.note_id=n.id AND a.revision_id=n.current_revision_id AND c.state='active' AND c.id!='all')
      ORDER BY n.created_at DESC`).all();
    return this.db.prepare(`SELECT n.id,n.current_revision_id AS revisionId,r.body AS text,r.excerpt AS excerpt,r.source_title AS sourceTitle,r.source_app AS sourceApp,n.created_at AS date,
      n.origin_kind AS originKind,n.is_demo AS isDemo,n.ai_excluded AS aiExcluded,n.ai_access_version AS aiAccessVersion,r.source_kind AS sourceKind,r.source_url AS sourceUrl FROM assignments a
      JOIN categories c ON c.id=a.category_id AND c.state='active'
      JOIN notes n ON n.id=a.note_id JOIN note_revisions r ON r.id=n.current_revision_id
      WHERE a.category_id=? AND a.revision_id=n.current_revision_id AND n.deleted_at IS NULL
      AND n.origin_kind='human' AND n.is_demo=0 ORDER BY n.created_at DESC`).all(categoryId);
  }
  analysisNotesFor(categoryId){return this.withArticles(this.notesFor(categoryId).filter(note=>!note.aiExcluded&&note.text.trim()));}
  aiSnapshotCurrent(items,contextRunIds=[]){
    return items.every(item=>{
      const note=this.db.prepare("SELECT current_revision_id AS revisionId,ai_access_version AS accessVersion FROM notes WHERE id=? AND deleted_at IS NULL AND origin_kind='human' AND is_demo=0 AND ai_excluded=0").get(item.id||item.noteId);
      return !!note&&note.revisionId===item.revisionId&&note.accessVersion===(item.aiAccessVersion??0);
    })&&contextRunIds.every(id=>{const run=this.db.prepare('SELECT purpose FROM runs WHERE id=? AND ai_blocked=0').get(id);return !!run&&(run.purpose!=='memory'||this.memoryContextCurrent(id))});
  }
  assertAiSnapshot(items,contextRunIds=[]){
    if(!this.aiSnapshotCurrent(items,contextRunIds))throw new Error('Notes or AI access changed during analysis. Run it again.');
  }
  insightSourceIds(categoryId){
    const sql=categoryId==='all'
      ? `SELECT n.current_revision_id AS revisionId FROM notes n JOIN note_revisions r ON r.id=n.current_revision_id
        WHERE n.deleted_at IS NULL AND n.origin_kind='human' AND n.is_demo=0 AND n.ai_excluded=0 AND trim(r.body)!=''
        ORDER BY n.created_at DESC LIMIT 30`
      : `SELECT n.current_revision_id AS revisionId FROM assignments a
        JOIN categories c ON c.id=a.category_id AND c.state='active'
        JOIN notes n ON n.id=a.note_id JOIN note_revisions r ON r.id=n.current_revision_id
        WHERE a.category_id=? AND a.revision_id=n.current_revision_id AND n.deleted_at IS NULL
        AND n.origin_kind='human' AND n.is_demo=0 AND n.ai_excluded=0 AND trim(r.body)!=''
        ORDER BY n.created_at DESC LIMIT 30`;
    return this.db.prepare(sql).all(...(categoryId==='all'?[]:[categoryId])).map(row=>row.revisionId).sort();
  }
  insightFingerprint(categoryId){
    const category=this.db.prepare("SELECT name FROM categories WHERE id=? AND state='active'").get(categoryId);
    if(!category)return null;
    return createHash('sha256').update(JSON.stringify({name:category.name,revisionIds:this.insightSourceIds(categoryId)})).digest('hex');
  }
  insightState(categoryId){
    if(categoryId==='other')return {status:'unavailable'};
    const latest=this.db.prepare(`SELECT id,run_id AS runId,status,created_at AS analyzedAt FROM outputs
      WHERE kind='summary' AND category_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1`).get(categoryId);
    if(!latest)return {status:'missing'};
    const expected=this.insightSourceIds(categoryId);
    const inputs=this.db.prepare('SELECT revision_id AS revisionId FROM analysis_inputs WHERE run_id=? ORDER BY revision_id').all(latest.runId).map(row=>row.revisionId);
    const current=latest.status==='current'&&expected.length===inputs.length&&expected.every((id,index)=>id===inputs[index]);
    return {status:current?'current':'needs-refresh',analyzedAt:latest.analyzedAt};
  }
  // The last digest of a category, to keep its wording where nothing changed. Not one rated Bad, not
  // one from a run AI exclusion blocked, and only claims whose sources are all still in `notes`.
  previousDigest(categoryId,notes){
    const row=this.db.prepare(`SELECT o.* FROM outputs o JOIN runs r ON r.id=o.run_id WHERE o.kind='summary' AND o.category_id=? AND o.status IN ('current','stale')
      AND r.ai_blocked=0 ORDER BY o.created_at DESC,o.rowid DESC LIMIT 1`).get(categoryId);
    if(!row)return null;
    const output=this.inflateOutput(row);
    if(output.rating?.rating==='bad'||output.analysis_status==='insufficient')return null;
    const current=new Set(notes.map(note=>note.revisionId));
    const claims=(output.claims||[]).map(claim=>({text:claim.text,kind:claim.kind,speaker:claim.speaker,period:claim.period||'',
      evidenceRevisionIds:claim.sources.filter(source=>source.relation!=='counter').map(source=>source.revisionId)}))
      .filter(claim=>claim.evidenceRevisionIds.length&&claim.evidenceRevisionIds.every(id=>current.has(id)));
    return claims.length?{runId:row.run_id,claims}:null;
  }
  latestOutput(kind,categoryId) {
    if(['summary','pattern','action'].includes(kind)&&this.insightState(categoryId).status!=='current')return undefined;
    const row = this.db.prepare(`SELECT o.* FROM outputs o WHERE o.kind=? AND o.category_id=? AND o.status='current'
      ORDER BY o.created_at DESC,o.rowid DESC LIMIT 1`).get(kind,categoryId);
    return row && this.inflateOutput(row);
  }
  nextSteps() {
    return this.db.prepare(`SELECT o.*,c.name AS category_name FROM outputs o JOIN categories c ON c.id=o.category_id
      WHERE o.kind='action' AND o.status='current' AND c.state='active'
      AND o.id=(SELECT newer.id FROM outputs newer WHERE newer.kind='action' AND newer.status='current'
        AND newer.category_id=o.category_id ORDER BY newer.created_at DESC,newer.rowid DESC LIMIT 1)
      ORDER BY o.created_at DESC,o.rowid DESC`).all().filter(o=>this.insightState(o.category_id).status==='current').map(o=>({...this.inflateOutput(o),categoryName:o.category_name}));
  }
  inflateOutput(row) {
    const evidence = this.db.prepare(`SELECT r.note_id AS noteId,e.revision_id AS revisionId,r.body AS text,r.excerpt AS excerpt,r.source_title AS sourceTitle,r.source_app AS sourceApp,
      r.source_kind AS sourceKind,
      CASE WHEN n.current_revision_id=e.revision_id AND n.deleted_at IS NULL THEN 1 ELSE 0 END AS valid
      FROM evidence e JOIN note_revisions r ON r.id=e.revision_id JOIN notes n ON n.id=r.note_id
      WHERE e.output_id=?`).all(row.id).map(e=>({...e,valid:!!e.valid}));
    const rating = this.db.prepare('SELECT rating,reason,comment FROM feedback WHERE output_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(row.id)||null;
    const limitation=row.kind==='answer'?this.db.prepare("SELECT text FROM outputs WHERE kind='limitation' AND parent_output_id=? LIMIT 1").get(row.id)?.text||null:null;
    const claims=row.kind==='summary'?this.db.prepare('SELECT * FROM digest_claims WHERE run_id=? ORDER BY rowid').all(row.run_id).map(claim=>({
      ...claim,sources:this.db.prepare(`SELECT e.revision_id AS revisionId,e.relation,r.note_id AS noteId,r.body AS text,r.excerpt AS excerpt,r.source_title AS sourceTitle,r.source_app AS sourceApp,r.source_kind AS sourceKind
        FROM digest_claim_evidence e JOIN note_revisions r ON r.id=e.revision_id WHERE e.claim_id=? ORDER BY e.relation,e.rowid`).all(claim.id)
    })):row.kind==='answer'?this.db.prepare('SELECT * FROM answer_claims WHERE output_id=? ORDER BY rowid').all(row.id).map(claim=>({
      ...claim,sources:this.db.prepare(`SELECT e.revision_id AS revisionId,r.note_id AS noteId,r.body AS text,r.excerpt AS excerpt,r.source_title AS sourceTitle,r.source_app AS sourceApp,r.source_kind AS sourceKind
        FROM answer_claim_evidence e JOIN note_revisions r ON r.id=e.revision_id WHERE e.claim_id=? ORDER BY e.rowid`).all(claim.id)
    })):[];
    return {...row,evidence,rating,limitation,claims};
  }
  feedbackFor(categoryId) {
    return this.db.prepare(`SELECT f.rating,f.reason,f.comment,o.kind,o.run_id AS _runId,
      CASE WHEN f.rating='bad' THEN substr(o.text,1,500) ELSE NULL END AS rejectedText
      FROM feedback f JOIN outputs o ON o.id=f.output_id
      WHERE o.category_id=? AND o.kind IN ('summary','pattern','action')
      AND f.id=(SELECT f2.id FROM feedback f2 WHERE f2.output_id=o.id ORDER BY f2.created_at DESC,f2.rowid DESC LIMIT 1)
      AND f.rating!='clear' AND o.run_id IN (SELECT id FROM runs WHERE ai_blocked=0)
      ORDER BY f.created_at DESC,f.rowid DESC LIMIT 12`).all(categoryId);
  }
  feedbackForAsk(question) {
    const normalize=s=>String(s).toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
    const grams=s=>{const value=normalize(s),set=new Set();for(let i=0;i<value.length-1;i++)set.add(value.slice(i,i+2));return set;};
    const wanted=grams(question);
    if(!wanted.size)return [];
    const rows=this.db.prepare(`SELECT q.question,f.rating,f.reason,f.comment,o.run_id AS _runId,
      CASE WHEN f.rating='bad' THEN substr(o.text,1,500) ELSE NULL END AS rejectedText
      FROM ask_questions q JOIN outputs o ON o.id=q.output_id JOIN feedback f ON f.output_id=o.id
      WHERE f.id=(SELECT f2.id FROM feedback f2 WHERE f2.output_id=o.id ORDER BY f2.created_at DESC,f2.rowid DESC LIMIT 1)
      AND f.rating!='clear' AND o.run_id IN (SELECT id FROM runs WHERE ai_blocked=0) ORDER BY f.created_at DESC,f.rowid DESC LIMIT 30`).all();
    return rows.filter(row=>{const other=grams(row.question);let common=0;for(const gram of wanted)if(other.has(gram))common++;return common/Math.max(1,Math.min(wanted.size,other.size))>=0.3}).slice(0,6);
  }
  saveAnalysis({purpose,categoryId,model,items,result,question,retrieval=[],fingerprint,contextRunIds=[],promptVersion='1'}) {
    const allowed=new Map(items.map(n=>[n.revisionId,n]));
    const evidenceIds=[...new Set(result.evidenceRevisionIds||[])];
    if (!result.text?.trim() || (result.status!=='insufficient'&&!evidenceIds.length) || evidenceIds.some(id=>!allowed.has(id))) throw new Error('AI result has missing or invalid evidence.');
    if (purpose==='collection' && result.status!=='insufficient' && (!result.action?.trim() || !result.pattern?.trim())) throw new Error('AI result is incomplete.');
    if(purpose==='collection'&&result.claims!==undefined){
      if(!Array.isArray(result.claims)||result.claims.length>12)throw new Error('AI result has invalid digest claims.');
      for(const claim of result.claims){
        if(!claim.text?.trim()||!['preference','experience','intention','observation','change','uncertainty'].includes(claim.kind)||
          !['self','external','unknown'].includes(claim.speaker)||typeof claim.period!=='string'||
          !Array.isArray(claim.evidenceRevisionIds)||!claim.evidenceRevisionIds.length||!Array.isArray(claim.counterRevisionIds)||
          [...claim.evidenceRevisionIds,...claim.counterRevisionIds].some(id=>!allowed.has(id)))throw new Error('AI result has invalid digest claim evidence.');
      }
    }
    if(purpose==='ask'&&result.claims!==undefined){
      if(!Array.isArray(result.claims)||result.claims.length>10||(result.status==='ready'&&!result.claims.length)||(result.status==='insufficient'&&result.claims.length))throw new Error('AI result has invalid answer claims.');
      for(const claim of result.claims){
        if(!claim.text?.trim()||!['record','inference'].includes(claim.kind)||!['self','external','unknown'].includes(claim.speaker)||
          typeof claim.period!=='string'||!Array.isArray(claim.evidenceRevisionIds)||!claim.evidenceRevisionIds.length||
          claim.evidenceRevisionIds.some(id=>!allowed.has(id)||!evidenceIds.includes(id)))throw new Error('AI result has unsupported answer claim.');
      }
    }
    this.assertAiSnapshot(items,contextRunIds);
    if(purpose==='collection'){
      const selected=[...new Set(items.map(item=>item.revisionId))].sort(),current=this.insightSourceIds(categoryId);
      if(selected.length!==current.length||selected.some((id,index)=>id!==current[index])||(fingerprint&&fingerprint!==this.insightFingerprint(categoryId)))throw new Error('Category changed during analysis. Run it again.');
    }
    return this.tx(() => {
      const now=new Date().toISOString(),runId=randomUUID();
      this.db.prepare('INSERT INTO runs(id,purpose,category_id,model,prompt_version,created_at,context_tracked) VALUES(?,?,?,?,?,?,1)').run(runId,purpose,categoryId,model,promptVersion,now);
      for(const sourceRunId of new Set(contextRunIds))this.db.prepare('INSERT INTO run_contexts(run_id,source_run_id) VALUES(?,?)').run(runId,sourceRunId);
      for(const revisionId of new Set(items.map(item=>item.revisionId)))this.db.prepare('INSERT INTO analysis_inputs(run_id,revision_id) VALUES(?,?)').run(runId,revisionId);
      for(const claim of purpose==='collection'?(result.claims||[]):[]){
        const claimId=randomUUID();
        this.db.prepare('INSERT INTO digest_claims(id,run_id,kind,speaker,period,text,created_at) VALUES(?,?,?,?,?,?,?)').run(claimId,runId,claim.kind,claim.speaker,claim.period,claim.text,now);
        for(const revisionId of new Set(claim.evidenceRevisionIds))this.db.prepare("INSERT INTO digest_claim_evidence(claim_id,revision_id,relation) VALUES(?,?,'support')").run(claimId,revisionId);
        for(const revisionId of new Set(claim.counterRevisionIds))this.db.prepare("INSERT INTO digest_claim_evidence(claim_id,revision_id,relation) VALUES(?,?,'counter')").run(claimId,revisionId);
      }
      if(purpose==='ask')for(const [index,item] of retrieval.entries())this.db.prepare('INSERT INTO retrieval_items(run_id,revision_id,rank,score,method) VALUES(?,?,?,?,?)').run(runId,item.revisionId,index+1,item.score,item.method);
      if (purpose==='collection') this.db.prepare("UPDATE outputs SET status='superseded' WHERE category_id=? AND kind IN ('summary','pattern','action') AND status='current'").run(categoryId);
      const save=(kind,text,ids,parentOutputId=null)=>{
        const id=randomUUID();
        this.db.prepare('INSERT INTO outputs(id,run_id,kind,text,category_id,analysis_status,parent_output_id,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,runId,kind,text,categoryId,result.status||'ready',parentOutputId,now);
        for(const revisionId of ids) this.db.prepare('INSERT INTO evidence(output_id,revision_id) VALUES(?,?)').run(id,revisionId);
        return id;
      };
      const mainId=save(purpose==='ask'?'answer':'summary',result.text,evidenceIds);
      if(purpose==='ask')for(const claim of result.claims||[]){
        const claimId=randomUUID();
        this.db.prepare('INSERT INTO answer_claims(id,output_id,kind,speaker,period,text) VALUES(?,?,?,?,?,?)').run(claimId,mainId,claim.kind,claim.speaker,claim.period,claim.text);
        for(const revisionId of new Set(claim.evidenceRevisionIds))this.db.prepare('INSERT INTO answer_claim_evidence(claim_id,revision_id) VALUES(?,?)').run(claimId,revisionId);
      }
      if(purpose==='collection'&&result.status!=='insufficient') {
        save('pattern',result.pattern,evidenceIds);
        save('action',result.action,evidenceIds);
        if(categoryId==='all'){
          const active=this.db.prepare("SELECT id,name FROM categories WHERE state='active' AND id!='all'").all();
          this.db.prepare(`UPDATE outputs SET status='stale' WHERE status='current' AND kind IN ('summary','pattern','action')
            AND category_id IN (SELECT id FROM categories WHERE state='active' AND id!='all')`).run();
          for(const note of items) this.db.prepare(`DELETE FROM assignments WHERE note_id=? AND origin='ai'
            AND category_id IN (SELECT id FROM categories WHERE state='active')`).run(note.id);
          for(const proposal of result.categories||[]){
            const category=active.find(c=>c.name.toLocaleLowerCase()===String(proposal.name||'').trim().toLocaleLowerCase());
            if(!category)continue;
            for(const revisionId of [...new Set(proposal.revisionIds||[])]){
              const note=allowed.get(revisionId);
              if(!note)continue;
              if(this.db.prepare('SELECT 1 FROM assignment_exclusions WHERE note_id=? AND category_id=? AND revision_id=?').get(note.id,category.id,revisionId))continue;
              this.db.prepare(`INSERT INTO assignments(note_id,category_id,revision_id,origin) VALUES(?,?,?,'ai')
                ON CONFLICT(note_id,category_id) DO UPDATE SET revision_id=excluded.revision_id
                WHERE assignments.origin='ai'`).run(note.id,category.id,revisionId);
            }
          }
        }
      } else if (purpose==='ask') {
        if(result.pattern?.trim())save('limitation',result.pattern,evidenceIds,mainId);
        this.db.prepare('INSERT INTO ask_questions(id,question,output_id,created_at) VALUES(?,?,?,?)').run(randomUUID(),question,mainId,now);
      }
      return this.inflateOutput(this.db.prepare('SELECT * FROM outputs WHERE id=?').get(mainId));
    });
  }
  rate(outputId,rating,reason='',comment='') {
    if(!['good','bad','clear'].includes(rating)) throw new Error('Invalid rating.');
    if(!this.db.prepare('SELECT id FROM outputs WHERE id=?').get(outputId)) throw new Error('Output not found.');
    this.db.prepare('INSERT INTO feedback(id,output_id,rating,reason,comment,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),outputId,rating,String(reason).slice(0,300),String(comment).slice(0,500),new Date().toISOString());
    return this.inflateOutput(this.db.prepare('SELECT * FROM outputs WHERE id=?').get(outputId));
  }
  questions() { return this.db.prepare('SELECT question,output_id,created_at FROM ask_questions ORDER BY created_at DESC,rowid DESC LIMIT 30').all().map(q=>({...q,output:this.inflateOutput(this.db.prepare('SELECT * FROM outputs WHERE id=?').get(q.output_id))})); }
  draft(value) { if(value===undefined) return this.db.prepare("SELECT value FROM app_state WHERE key='draft'").get()?.value||''; this.db.prepare("INSERT INTO app_state(key,value) VALUES('draft',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(value); }
  draftOrigin(value) { if(value===undefined) return this.db.prepare("SELECT value FROM app_state WHERE key='draft_origin'").get()?.value==='generated'?'generated':'human'; this.db.prepare("INSERT INTO app_state(key,value) VALUES('draft_origin',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(value==='generated'?'generated':'human'); }
  draftSource(value) { if(value===undefined) return this.db.prepare("SELECT value FROM app_state WHERE key='draft_source'").get()?.value||'unspecified'; this.db.prepare("INSERT INTO app_state(key,value) VALUES('draft_source',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(['unspecified','thought','reference','quote'].includes(value)?value:'unspecified'); }
  draftEditing(value) { if(value===undefined) return this.db.prepare("SELECT value FROM app_state WHERE key='draft_editing'").get()?.value||''; this.db.prepare("INSERT INTO app_state(key,value) VALUES('draft_editing',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(typeof value==='string'?value:''); }
  draftUpdatedAt() { return Number(this.db.prepare("SELECT value FROM app_state WHERE key='draft_updated_at'").get()?.value||0); }
  draftAiExcluded(value){
    if(value===undefined)return this.db.prepare("SELECT value FROM app_state WHERE key='draft_ai_excluded'").get()?.value==='true';
    this.db.prepare("INSERT INTO app_state(key,value) VALUES('draft_ai_excluded',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(value?'true':'false');
  }
  writeDraftSnapshot(input){
    const text=String(input?.text||'');
    if(text.length>100000)throw new Error('Draft is too long.');
    const updatedAt=Number(input?.updatedAt);
    if(!Number.isSafeInteger(updatedAt)||updatedAt<=0)throw new Error('Invalid draft timestamp.');
    if(updatedAt<=this.draftUpdatedAt())return false;
    this.draft(text);this.draftOrigin(input?.originKind);this.draftSource(input?.sourceKind);
    this.draftEditing(text?input?.editingId:'');
    this.draftAiExcluded(!!text&&input?.aiExcluded===true);
    this.db.prepare("INSERT INTO app_state(key,value) VALUES('draft_updated_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(updatedAt));
    return true;
  }
  saveDraftSnapshot(input){return this.tx(()=>this.writeDraftSnapshot(input));}
  async backupTo(file) { await backup(this.db,file); return file; }
  validateRelations(){
    if(this.db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Backup integrity check failed.');
    if(this.db.prepare('PRAGMA foreign_key_check').get())throw new Error('Backup has broken database references.');
    if(this.db.prepare(`SELECT 1 FROM notes n LEFT JOIN note_revisions r
      ON r.id=n.current_revision_id AND r.note_id=n.id WHERE r.id IS NULL LIMIT 1`).get())throw new Error('Backup has a note without its current version.');
    for(const table of ['assignments','assignment_exclusions','classification_jobs']){
      if(this.db.prepare(`SELECT 1 FROM ${table} a JOIN note_revisions r ON r.id=a.revision_id
        WHERE r.note_id!=a.note_id LIMIT 1`).get())throw new Error('Backup has a category or job linked to the wrong note version.');
    }
    if(this.db.prepare("SELECT 1 FROM categories WHERE id='all' AND state!='active' LIMIT 1").get())throw new Error('Backup has an invalid All notes category.');
    if(this.db.prepare('SELECT 1 FROM purged_notes p JOIN notes n ON n.id=p.id LIMIT 1').get())throw new Error('Backup contains a permanently deleted note.');
  }
  async restoreFrom(source,rollback) {
    const stage=this.file+'.restore-'+randomUUID();
    let probe,closed=false;
    try {
      probe=new DatabaseSync(source,{readOnly:true});
      if(probe.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Backup integrity check failed.');
      for(const table of ['notes','note_revisions','outputs','evidence','feedback']) if(!probe.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))throw new Error('This is not a pure backup.');
      await backup(probe,stage);
      probe.close();probe=null;
      const prepared=new Store(stage);
      try{
        // Restoring an older backup must not silently re-enable explicitly excluded notes.
        for(const note of this.db.prepare('SELECT id FROM notes WHERE ai_excluded=1').all()){
          if(prepared.db.prepare('SELECT 1 FROM notes WHERE id=?').get(note.id))prepared.setAiExcluded({id:note.id,excluded:true},{allowTrashed:true});
        }
        prepared.validateRelations();
        const tombstones=this.db.prepare('SELECT id,purged_at AS purgedAt FROM purged_notes').all();
        for(const item of tombstones){
          if(prepared.db.prepare('SELECT 1 FROM notes WHERE id=?').get(item.id))throw new Error('This backup would restore a permanently deleted note.');
          prepared.db.prepare('INSERT INTO purged_notes(id,purged_at) VALUES(?,?) ON CONFLICT(id) DO NOTHING').run(item.id,item.purgedAt);
        }
        prepared.validateRelations();
      }finally{prepared.close();}
      fs.mkdirSync(path.dirname(rollback),{recursive:true});
      await this.backupTo(rollback);
      this.close();closed=true;
      fs.rmSync(this.file+'-wal',{force:true});fs.rmSync(this.file+'-shm',{force:true});
      fs.renameSync(stage,this.file);
      this.db=new Store(this.file).db;
    } catch(error) {
      if(closed){fs.copyFileSync(rollback,this.file);this.db=new Store(this.file).db;}
      throw error;
    } finally {
      if(probe)probe.close();
      fs.rmSync(stage,{force:true});fs.rmSync(stage+'-wal',{force:true});fs.rmSync(stage+'-shm',{force:true});
    }
    return rollback;
  }
  importLegacy(rows) {
    if(!Array.isArray(rows)||rows.length>100000) throw new Error('Invalid notes file.');
    const demoIds=new Set(['rain','film','cafe','quiet','alone','habit','coffee','season','walk','cinema','watch','book','room','library','sea','music-night','music-focus']);
    return this.tx(()=>{
      let count=0;
      for(const item of rows) {
        if(typeof item?.id!=='string'||typeof item.text!=='string'||!item.text.trim()||item.text.length>100000) continue;
        if(this.db.prepare('SELECT id FROM notes WHERE id=?').get(item.id)||this.db.prepare('SELECT id FROM purged_notes WHERE id=?').get(item.id)) continue;
        const date=Number.isFinite(Date.parse(item.date))?new Date(item.date).toISOString():new Date().toISOString();
        const revisionId=randomUUID(),demo=demoIds.has(item.id)?1:0;
        this.db.prepare('INSERT INTO notes(id,current_revision_id,created_at,origin_kind,is_demo) VALUES(?,?,?,?,?)').run(item.id,revisionId,date,item.origin?'generated':'human',demo);
        this.db.prepare('INSERT INTO note_revisions(id,note_id,body,created_at) VALUES(?,?,?,?)').run(revisionId,item.id,item.text,date);
        count++;
      }
      return count;
    });
  }
  close(){this.db.close();}
}
module.exports={Store};
