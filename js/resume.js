// 简历解析（PDF/DOCX）、本地存储（IndexedDB）、技能抽取与匹配
import { extractSkills } from './skills.js';

const DB = 'qiuzhao';
const STORE = 'resume';

export function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains('watch')) db.createObjectStore('watch');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveResume({ text, skills, fileName }) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ text, skills, fileName, savedAt: Date.now() }, 'current');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadResume() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).get('current');
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
}

export async function parsePdf(file) {
  const pdfjsLib = window.pdfjsLib;
  if (!pdfjsLib) throw new Error('PDF 解析库未加载（请检查网络能否访问 CDN）');
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(it => it.str).join(' ') + '\n';
  }
  return text;
}

export async function parseDocx(file) {
  if (!window.mammoth) throw new Error('DOCX 解析库未加载（请检查网络能否访问 CDN）');
  const buf = await file.arrayBuffer();
  const res = await window.mammoth.extractRawText({ arrayBuffer: buf });
  return res.value;
}

export async function parseResumeFile(file) {
  const name = file.name.toLowerCase();
  let text;
  if (name.endsWith('.pdf')) text = await parsePdf(file);
  else if (name.endsWith('.docx')) text = await parseDocx(file);
  else throw new Error('仅支持 PDF / DOCX 格式');
  if (!text || !text.trim()) throw new Error('未能提取到文本，请确认文件非扫描图片版');
  const skills = extractSkills(text);
  return { text, skills, fileName: file.name };
}

// 重叠度匹配：score = 命中技能数 / 简历技能数（召回视角）
export function matchJobs(resumeSkills, jobs) {
  if (!resumeSkills || resumeSkills.length === 0) return [];
  const rs = new Set(resumeSkills);
  return jobs
    .map(j => {
      const js = j.skills || [];
      const hit = js.filter(s => rs.has(s));
      const miss = js.filter(s => !rs.has(s));
      return { job: j, hit, miss, score: hit.length / rs.size };
    })
    .filter(x => x.hit.length > 0)
    .sort((a, b) => b.score - a.score || b.hit.length - a.hit.length);
}
