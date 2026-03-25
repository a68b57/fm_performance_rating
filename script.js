// 场景评分映射：1分(-10), 2分(-5), 3分(0), 4分(+5), 5分(+10)
const SCORE_MAP = {
    1: -10,
    2: -5,
    3: 0,
    4: 5,
    5: 10
};

// 场景初始分
const INITIAL_SCENARIO_SCORE = 50;
const MAX_SCENARIO_SCORE = 100;
const MIN_SCENARIO_SCORE = 0;

// 微行为初始分和扣分
const INITIAL_MICRO_SCORE = 100;
const MICRO_DEDUCTION = 2;

// Bonus初始分和分数
const INITIAL_BONUS_SCORE = 0;
const MAX_BONUS_SCORE = 20;
const MIN_BONUS_SCORE = 0;
const BONUS_POINTS = 3; // 每次点赞或惩罚的分数

// 存储场景记录
const scenarioRecords = {
    '园区': [],
    '闸机': [],
    '直角弯': [],
    '绕行': [],
    '会车': [],
    '坡道': []
};

// 导出用事件日志（场景、微行为、用户bonus 的每次记录）
const eventLogs = [];

// 子场景展示名（语音弹层等）
const SCENARIO_LABELS = {
    '园区': '进出园区',
    '闸机': '进出闸机',
    '直角弯': '直角弯（路沿&立柱）',
    '绕行': '绕行VRU/静态',
    '会车': '会车',
    '坡道': '进出坡道'
};

// 记录导出事件（extra 可含 recordId 等）
function logEvent(type, name, value, deltaPoints, time, extra) {
    const entry = {
        type,
        name,
        value,
        deltaPoints,
        time: time || new Date()
    };
    if (extra && typeof extra === 'object') {
        Object.assign(entry, extra);
    }
    eventLogs.push(entry);
}

// ---------- 低分语音：IndexedDB 存音频（本机） ----------
const AUDIO_DB_NAME = 'park_ida_voice_v1';
const AUDIO_STORE = 'clips';

function openAudioDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(AUDIO_DB_NAME, 1);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(AUDIO_STORE)) {
                db.createObjectStore(AUDIO_STORE, { keyPath: 'recordId' });
            }
        };
    });
}

function saveAudioClip(recordId, scenarioName, blob, mimeType) {
    return openAudioDB().then((db) => new Promise((resolve, reject) => {
        const tx = db.transaction(AUDIO_STORE, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore(AUDIO_STORE).put({
            recordId,
            scenarioName,
            blob,
            mimeType: mimeType || blob.type || 'audio/webm',
            createdAt: Date.now()
        });
    }));
}

function deleteAudioClip(recordId) {
    return openAudioDB().then((db) => new Promise((resolve, reject) => {
        const tx = db.transaction(AUDIO_STORE, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore(AUDIO_STORE).delete(recordId);
    }));
}

function clearAllAudioClips() {
    return openAudioDB().then((db) => new Promise((resolve, reject) => {
        const tx = db.transaction(AUDIO_STORE, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore(AUDIO_STORE).clear();
    }));
}

function getAudioClip(recordId) {
    return openAudioDB().then((db) => new Promise((resolve, reject) => {
        const tx = db.transaction(AUDIO_STORE, 'readonly');
        tx.oncomplete = () => {};
        tx.onerror = () => reject(tx.error);
        const req = tx.objectStore(AUDIO_STORE).get(recordId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    })).catch(() => null);
}

function detectAudioExt(mimeType) {
    const t = (mimeType || '').toLowerCase();
    if (t.includes('mp4') || t.includes('m4a')) return 'm4a';
    if (t.includes('ogg')) return 'ogg';
    if (t.includes('wav')) return 'wav';
    return 'webm';
}

let voiceModalPending = null;
let voiceMediaRecorder = null;
let voiceMediaStream = null;
let voiceChunks = [];
let voiceLastBlob = null;
let voiceMimeType = '';

// 聊天工具式交互：按住开始录音，松开停止并自动保存
let voiceAutoSaveOnStop = true;
let voiceHoldTimer = null;
let voiceHolding = false;
let voiceHoldStarted = false;
const VOICE_HOLD_MS = 350;

function pickAudioMimeType() {
    const c = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus'
    ];
    for (let i = 0; i < c.length; i++) {
        if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c[i])) {
            return c[i];
        }
    }
    return '';
}

function voiceModalSetStep(step) {
    const idle = document.getElementById('voice-modal-step-idle');
    const rec = document.getElementById('voice-modal-step-recording');
    const rev = document.getElementById('voice-modal-step-review');
    const st = document.getElementById('voice-modal-status');
    if (st) st.textContent = '';
    [idle, rec, rev].forEach((el) => {
        if (el) el.classList.add('voice-modal-hidden');
    });
    if (step === 'idle' && idle) idle.classList.remove('voice-modal-hidden');
    if (step === 'recording' && rec) rec.classList.remove('voice-modal-hidden');
    if (step === 'review' && rev) rev.classList.remove('voice-modal-hidden');
}

function stopVoiceStream() {
    if (voiceMediaStream) {
        voiceMediaStream.getTracks().forEach((t) => t.stop());
        voiceMediaStream = null;
    }
}

function closeVoiceModal() {
    if (voiceMediaRecorder && voiceMediaRecorder.state === 'recording') {
        try {
            voiceMediaRecorder.stop();
        } catch (e) { /* ignore */ }
    }
    voiceMediaRecorder = null;
    stopVoiceStream();
    voiceChunks = [];
    voiceLastBlob = null;
    voiceMimeType = '';
    voiceModalPending = null;
    const modal = document.getElementById('voice-modal');
    if (modal) {
        modal.classList.remove('voice-modal-open');
        modal.setAttribute('aria-hidden', 'true');
    }
    voiceModalSetStep('idle');
}

function openVoiceModal(scenarioName, score, recordId) {
    voiceModalPending = { scenarioName, score, recordId };
    voiceAutoSaveOnStop = true;
    voiceHolding = false;
    voiceHoldStarted = false;
    voiceHoldTimer = null;
    const ctx = document.getElementById('voice-modal-context');
    if (ctx) {
        const label = SCENARIO_LABELS[scenarioName] || scenarioName;
        ctx.textContent = `${label} · 评分${score}分`;
    }
    voiceModalSetStep('idle');
    const modal = document.getElementById('voice-modal');
    if (modal) {
        modal.classList.add('voice-modal-open');
        modal.setAttribute('aria-hidden', 'false');
    }
}

function attachVoiceModalHandlers() {
    const skip = document.getElementById('btn-voice-skip');
    const hold = document.getElementById('btn-voice-hold');
    const start = document.getElementById('btn-voice-start');
    const stop = document.getElementById('btn-voice-stop');
    const play = document.getElementById('btn-voice-play');
    const redo = document.getElementById('btn-voice-redo');
    const save = document.getElementById('btn-voice-save');
    const backdrop = document.getElementById('voice-modal-backdrop');

    if (skip) skip.onclick = () => closeVoiceModal();
    if (backdrop) {
        backdrop.onclick = () => {
            const rec = document.getElementById('voice-modal-step-recording');
            if (rec && !rec.classList.contains('voice-modal-hidden')) return;
            closeVoiceModal();
        };
    }

    if (start) {
        start.onclick = async () => {
            const st = document.getElementById('voice-modal-status');
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                if (st) st.textContent = '当前环境无法使用麦克风（需 HTTPS 或 localhost）。';
                return;
            }
            if (typeof MediaRecorder === 'undefined') {
                if (st) st.textContent = '当前浏览器不支持录音。';
                return;
            }
            // 用户松开得过快：不再启动录音
            if (!voiceHolding) return;
            voiceMimeType = pickAudioMimeType();
            try {
                stopVoiceStream();
                voiceMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                voiceChunks = [];
                const options = voiceMimeType ? { mimeType: voiceMimeType } : {};
                voiceMediaRecorder = new MediaRecorder(voiceMediaStream, options);
                if (!voiceMimeType && voiceMediaRecorder.mimeType) {
                    voiceMimeType = voiceMediaRecorder.mimeType;
                }
                voiceMediaRecorder.ondataavailable = (e) => {
                    if (e.data && e.data.size > 0) voiceChunks.push(e.data);
                };
                voiceMediaRecorder.onstop = () => {
                    stopVoiceStream();
                    voiceLastBlob = new Blob(voiceChunks, { type: voiceMimeType || 'audio/webm' });

                    // 长按交互：松开后自动保存并关闭弹层，不进入复杂“试听/重录/保存”流程。
                    if (voiceAutoSaveOnStop) {
                        voiceAutoSaveOnStop = false;

                        const pending = voiceModalPending;
                        const scenarioName = pending ? pending.scenarioName : null;
                        const recordId = pending ? pending.recordId : null;

                        const arr = scenarioName ? scenarioRecords[scenarioName] : null;
                        const rec = arr && recordId != null
                            ? arr.find((r) => r.id === recordId)
                            : null;

                        if (!scenarioName || recordId == null || !voiceLastBlob) {
                            closeVoiceModal();
                            return;
                        }

                        saveAudioClip(recordId, scenarioName, voiceLastBlob, voiceMimeType)
                            .then(() => {
                                if (rec) rec.hasAudio = true;
                                saveToLocalStorage();
                            })
                            .catch(() => {})
                            .finally(() => {
                                closeVoiceModal();
                            });
                        return;
                    }

                    voiceModalSetStep('review');
                };
                voiceMediaRecorder.start();
                voiceModalSetStep('recording');
            } catch (err) {
                if (st) st.textContent = '无法访问麦克风：' + (err.message || '请检查权限');
                stopVoiceStream();
            }
        };
    }

    if (stop) {
        stop.onclick = () => {
            if (voiceMediaRecorder && voiceMediaRecorder.state === 'recording') {
                voiceMediaRecorder.stop();
            }
        };
    }

    // 聊天工具式交互：按住录音（超过阈值才开始），松开则停止并保存
    if (hold) {
        hold.addEventListener('pointerdown', (e) => {
            // 只响应主指针
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            e.preventDefault();
            voiceHolding = true;
            voiceHoldStarted = false;
            if (voiceHoldTimer) clearTimeout(voiceHoldTimer);

            voiceHoldTimer = setTimeout(() => {
                if (!voiceHolding) return;
                voiceHoldStarted = true;
                voiceAutoSaveOnStop = true;
                if (start) start.click();
            }, VOICE_HOLD_MS);

            const onUp = () => {
                voiceHolding = false;
                if (voiceHoldTimer) clearTimeout(voiceHoldTimer);
                voiceHoldTimer = null;

                // 还没真正开始录音：取消并关闭弹层
                if (!voiceHoldStarted) {
                    closeVoiceModal();
                    return;
                }

                // 已开始：松开停止（触发 onstop 自动保存）
                voiceHoldStarted = false;
                if (stop) stop.click();
            };

            // 松开/取消时统一处理
            document.addEventListener('pointerup', onUp, { once: true });
            document.addEventListener('pointercancel', onUp, { once: true });
        }, { passive: false });
    }

    if (play) {
        play.onclick = () => {
            if (!voiceLastBlob) return;
            const url = URL.createObjectURL(voiceLastBlob);
            const a = new Audio(url);
            a.play().finally(() => setTimeout(() => URL.revokeObjectURL(url), 2000));
        };
    }

    if (redo) {
        redo.onclick = () => {
            voiceLastBlob = null;
            voiceChunks = [];
            voiceModalSetStep('idle');
        };
    }

    if (save) {
        save.onclick = () => {
            if (!voiceModalPending || !voiceLastBlob) return;
            const { scenarioName, recordId } = voiceModalPending;
            const arr = scenarioRecords[scenarioName];
            const rec = arr ? arr.find((r) => r.id === recordId) : null;
            if (!rec) {
                closeVoiceModal();
                return;
            }
            saveAudioClip(recordId, scenarioName, voiceLastBlob, voiceMimeType)
                .then(() => {
                    rec.hasAudio = true;
                    saveToLocalStorage();
                    closeVoiceModal();
                })
                .catch((e) => {
                    const st = document.getElementById('voice-modal-status');
                    if (st) st.textContent = '保存失败：' + (e.message || '');
                });
        };
    }
}

function logVoiceNoteForExport(log) {
    if (log.type !== '综合场景' || log.recordId == null) return '';
    const arr = scenarioRecords[log.name] || [];
    const r = arr.find((x) => x.id === log.recordId);
    return r && r.hasAudio ? '有' : '';
}

// 保存数据到localStorage
function saveToLocalStorage() {
    try {
        localStorage.setItem('scenarioRecords', JSON.stringify(scenarioRecords));
        localStorage.setItem('behaviorCounts', JSON.stringify(behaviorCounts));
        localStorage.setItem('bonusCounts', JSON.stringify(bonusCounts));
        localStorage.setItem('eventLogs', JSON.stringify(eventLogs));
    } catch (e) {
        console.error('保存数据失败', e);
    }
}

// 从localStorage加载数据
function loadFromLocalStorage() {
    try {
        const storedRecords = localStorage.getItem('scenarioRecords');
        const storedBehaviors = localStorage.getItem('behaviorCounts');
        const storedBonus = localStorage.getItem('bonusCounts');
        const storedEventLogs = localStorage.getItem('eventLogs');
        
        if (storedRecords) {
            const parsed = JSON.parse(storedRecords);
            Object.keys(parsed).forEach(key => {
                if (scenarioRecords[key]) {
                    // 恢复时间对象
                    scenarioRecords[key] = parsed[key].map(r => ({
                        ...r,
                        time: new Date(r.time),
                        hasAudio: !!r.hasAudio
                    }));
                }
            });
        }
        
        if (storedBehaviors) {
            Object.assign(behaviorCounts, JSON.parse(storedBehaviors));
        }
        
        if (storedBonus) {
            Object.assign(bonusCounts, JSON.parse(storedBonus));
        }
        
        if (storedEventLogs) {
            const parsed = JSON.parse(storedEventLogs);
            eventLogs.length = 0;
            parsed.forEach(log => {
                eventLogs.push({
                    ...log,
                    time: new Date(log.time)
                });
            });
        }
    } catch (e) {
        console.error('加载数据失败', e);
    }
}

// 记录场景评分（直接点击按钮）
function recordScenario(scenarioName, score) {
    const recordId = Date.now() + Math.random(); // 确保唯一ID
    const now = new Date();
    scenarioRecords[scenarioName].push({
        id: recordId,
        score: score,
        time: now,
        hasAudio: false
    });
    
    // 记录导出事件（场景）
    const deltaPoints = SCORE_MAP[score];
    logEvent('综合场景', scenarioName, `评分${score}`, deltaPoints, now, { recordId });
    
    // 保存到localStorage
    saveToLocalStorage();
    
    // 视觉反馈
    const ev = typeof event !== 'undefined' ? event : (typeof window !== 'undefined' ? window.event : null);
    const button = ev && ev.target && ev.target.closest ? ev.target.closest('.score-btn') : null;
    if (button) {
        button.classList.add('clicked');
        setTimeout(() => button.classList.remove('clicked'), 300);
    }
    
    // 更新场景得分（这会触发总分更新）
    updateScenarioScore(scenarioName);
    updateRecentRecords(scenarioName);
    
    // 添加分数更新动画效果
    highlightScoreUpdate();

    // 低分（1、2）可录语音备注
    if (score === 1 || score === 2) {
        openVoiceModal(scenarioName, score, recordId);
    }
}

// 撤销该子场景最近一次评分记录
function undoLastScenarioRecord(scenarioName) {
    const arr = scenarioRecords[scenarioName];
    if (!arr || arr.length === 0) {
        return;
    }

    const removed = arr.pop();
    if (removed && removed.id != null) {
        deleteAudioClip(removed.id).catch(() => {});
    }

    // 从 eventLogs 中移除该子场景最近一条「综合场景」记录（与 pop 顺序一致）
    for (let i = eventLogs.length - 1; i >= 0; i--) {
        if (eventLogs[i].type === '综合场景' && eventLogs[i].name === scenarioName) {
            eventLogs.splice(i, 1);
            break;
        }
    }

    saveToLocalStorage();
    updateScenarioScore(scenarioName);
    updateRecentRecords(scenarioName);
    highlightScoreUpdate();
}

// 删除场景记录
function removeScenarioRecord(scenarioName, recordId) {
    scenarioRecords[scenarioName] = scenarioRecords[scenarioName].filter(r => r.id !== recordId);
    deleteAudioClip(recordId).catch(() => {});
    updateScenarioScore(scenarioName);
    updateRecentRecords(scenarioName);
    highlightScoreUpdate();
}

// 更新场景得分
function updateScenarioScore(scenarioName) {
    const records = scenarioRecords[scenarioName];
    let totalChange = 0;
    
    records.forEach(record => {
        totalChange += SCORE_MAP[record.score];
    });
    
    // 计算场景得分（初始60分 + 所有变化）
    let scenarioScore = INITIAL_SCENARIO_SCORE + totalChange;
    scenarioScore = Math.max(MIN_SCENARIO_SCORE, Math.min(MAX_SCENARIO_SCORE, scenarioScore));
    
    // 更新已记录次数
    const countEl = document.getElementById(`count-${scenarioName}`);
    if (countEl) {
        countEl.textContent = records.length;
    }

    const undoBtn = document.getElementById(`undo-${scenarioName}`);
    if (undoBtn) {
        undoBtn.disabled = records.length === 0;
    }
    
    // 更新总分
    updateTotalScore();
}

// 更新最近记录显示（已移除，不再需要）
function updateRecentRecords(scenarioName) {
    // 不再显示记录
}

// 存储微行为次数
const behaviorCounts = {
    '顿挫': 0,
    '不居中': 0,
    '无故低速': 0,
    '速度偏快': 0,
    '反复修正方向盘': 0,
    '异常降级/退出': 0,
    '溜车': 0,
    '停止位置远': 0,
    '行泊切换异常': 0
};

// 改变微行为次数
function changeBehaviorCount(behaviorName, delta) {
    const oldCount = behaviorCounts[behaviorName];
    const newCount = Math.max(0, behaviorCounts[behaviorName] + delta);
    const actualDelta = newCount - oldCount;
    behaviorCounts[behaviorName] = newCount;
    updateBehaviorDisplay(behaviorName);
    updateMicroBehavior();
    // 记录导出事件（微行为），只记录实际发生的变化
    if (actualDelta !== 0) {
        const now = new Date();
        const deltaPoints = -actualDelta * MICRO_DEDUCTION; // 每次扣2分
        logEvent('微行为', behaviorName, `变化${actualDelta > 0 ? '+' : ''}${actualDelta}次`, deltaPoints, now);
        // 保存到localStorage
        saveToLocalStorage();
    }
}

// 更新微行为显示
function updateBehaviorDisplay(behaviorName) {
    const count = behaviorCounts[behaviorName];
    const countEl = document.getElementById(`count-${behaviorName}`);
    
    if (countEl) {
        countEl.textContent = count;
    }
}

// 更新微行为得分
function updateMicroBehavior() {
    let totalDeduction = 0;
    
    Object.keys(behaviorCounts).forEach(behaviorName => {
        totalDeduction += behaviorCounts[behaviorName] * MICRO_DEDUCTION;
    });
    
    const microScore = Math.max(0, Math.min(INITIAL_MICRO_SCORE, INITIAL_MICRO_SCORE - totalDeduction));
    const microScoreEl = document.getElementById('micro-behavior-total');
    if (microScoreEl) {
        microScoreEl.textContent = microScore.toFixed(0);
    }
    
    updateTotalScore();
    highlightScoreUpdate();
}

// 存储Bonus次数
const bonusCounts = {
    '点赞': 0,
    '惩罚': 0
};

// 改变Bonus次数
function changeBonusCount(bonusType, delta) {
    const oldCount = bonusCounts[bonusType];
    const newCount = Math.max(0, bonusCounts[bonusType] + delta);
    const actualDelta = newCount - oldCount;
    bonusCounts[bonusType] = newCount;
    updateBonusDisplay(bonusType);
    updateBonus();
    // 记录导出事件（用户bonus），只记录实际发生的变化
    if (actualDelta !== 0) {
        const now = new Date();
        const sign = bonusType === '点赞' ? 1 : -1;
        const deltaPoints = sign * actualDelta * BONUS_POINTS;
        logEvent('用户bonus', bonusType, `变化${actualDelta > 0 ? '+' : ''}${actualDelta}次`, deltaPoints, now);
        // 保存到localStorage
        saveToLocalStorage();
    }
}

// 更新Bonus显示
function updateBonusDisplay(bonusType) {
    const count = bonusCounts[bonusType];
    const countEl = document.getElementById(`count-${bonusType}`);
    
    if (countEl) {
        countEl.textContent = count;
    }
}

// 更新Bonus得分
function updateBonus() {
    let totalBonus = 0;
    
    totalBonus += bonusCounts['点赞'] * BONUS_POINTS;
    totalBonus -= bonusCounts['惩罚'] * BONUS_POINTS;
    
    const bonusScore = Math.max(MIN_BONUS_SCORE, Math.min(MAX_BONUS_SCORE, totalBonus));
    const bonusScoreEl = document.getElementById('bonus-total');
    if (bonusScoreEl) {
        bonusScoreEl.textContent = bonusScore.toFixed(0);
    }
    
    updateTotalScore();
    highlightScoreUpdate();
}

// 更新总分
function updateTotalScore() {
    // 计算综合场景分（加权平均）
    const scenarioItems = document.querySelectorAll('.scenario-card');
    let weightedScenarioTotal = 0;
    
    scenarioItems.forEach(item => {
        const scenarioName = item.dataset.scenario;
        const weight = parseFloat(item.dataset.weight);
        const records = scenarioRecords[scenarioName];
        let totalChange = 0;
        
        records.forEach(record => {
            totalChange += SCORE_MAP[record.score];
        });
        
        let scenarioScore = INITIAL_SCENARIO_SCORE + totalChange;
        scenarioScore = Math.max(MIN_SCENARIO_SCORE, Math.min(MAX_SCENARIO_SCORE, scenarioScore));
        weightedScenarioTotal += weight * scenarioScore;
    });
    
    // 计算微行为得分
    const microScoreElement = document.getElementById('micro-behavior-total');
    const microScore = microScoreElement ? parseFloat(microScoreElement.textContent) || INITIAL_MICRO_SCORE : INITIAL_MICRO_SCORE;
    
    // 计算Bonus得分
    const bonusScoreElement = document.getElementById('bonus-total');
    const bonusScore = bonusScoreElement ? parseFloat(bonusScoreElement.textContent) || INITIAL_BONUS_SCORE : INITIAL_BONUS_SCORE;
    
    // 计算最终得分：总分 = 0.6*综合场景分 + 0.3*微行为得分 + 用户bonus
    const finalScore = 0.6 * weightedScenarioTotal + 0.3 * microScore + bonusScore;
    
    // 更新显示
    const scenarioTotalEl = document.getElementById('scenario-total');
    const finalTotalEl = document.getElementById('final-total');
    
    if (scenarioTotalEl) scenarioTotalEl.textContent = weightedScenarioTotal.toFixed(2);
    if (finalTotalEl) finalTotalEl.textContent = finalScore.toFixed(2);
}

// 高亮分数更新效果
function highlightScoreUpdate() {
    const elements = [
        'scenario-total',
        'micro-behavior-total',
        'bonus-total',
        'final-total'
    ];
    
    elements.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.add('score-updated');
            setTimeout(() => el.classList.remove('score-updated'), 500);
        }
    });
}

// 导出为"Excel"（生成 CSV 文件；若有语音则导出 ZIP: CSV+语音）
async function exportToExcel() {
    // 确保从localStorage重新加载eventLogs（防止页面刷新后丢失）
    try {
        const storedEventLogs = localStorage.getItem('eventLogs');
        if (storedEventLogs) {
            const parsed = JSON.parse(storedEventLogs);
            eventLogs.length = 0;
            parsed.forEach(log => {
                eventLogs.push({
                    ...log,
                    time: new Date(log.time)
                });
            });
        }
    } catch (e) {
        console.error('加载导出数据失败', e);
    }
    
    // 使用保存的eventLogs
    if (!eventLogs.length) {
        alert('当前没有可导出的记录。');
        return;
    }

    const header = ['类型', '子项', '评分/变化', '得分变化', '时间点', '语音备注'];
    const rows = [header];

    eventLogs.forEach(log => {
        const timeStr = new Date(log.time).toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        // 使用中文逗号，避免与CSV分隔符冲突
        rows.push([
            log.type,
            log.name,
            String(log.value).replace(/,/g, '，'),
            (log.deltaPoints >= 0 ? '+' : '') + log.deltaPoints,
            timeStr,
            logVoiceNoteForExport(log)
        ]);
    });

    const csvContent = rows
        .map(row => row.map(col => `"${String(col).replace(/"/g, '""')}"`).join(','))
        .join('\r\n');

    // 添加BOM以支持Excel正确显示中文
    const BOM = '\uFEFF';
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = new Date().toTimeString().slice(0, 8).replace(/:/g, '');

    const voiceLogs = eventLogs.filter(log =>
        log.type === '综合场景' &&
        log.recordId != null &&
        logVoiceNoteForExport(log) === '有'
    );

    // 无语音时保持原 CSV 下载
    if (!voiceLogs.length) {
        const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `园区智驾体验分记录_${dateStr}_${timeStr}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return;
    }

    if (typeof JSZip === 'undefined') {
        alert('检测到语音备注，但缺少打包组件，暂无法导出语音文件。请刷新页面后重试。');
        return;
    }

    const zip = new JSZip();
    zip.file(`园区智驾体验分记录_${dateStr}_${timeStr}.csv`, BOM + csvContent);
    const voiceFolder = zip.folder('语音备注');

    for (let i = 0; i < voiceLogs.length; i++) {
        const log = voiceLogs[i];
        const clip = await getAudioClip(log.recordId);
        if (!clip || !clip.blob) continue;
        const ext = detectAudioExt(clip.mimeType || clip.blob.type);
        const safeScenario = String(log.name).replace(/[\\/:*?"<>|]/g, '_');
        const ts = new Date(log.time).toISOString().replace(/[:.]/g, '-');
        const filename = `${String(i + 1).padStart(2, '0')}_${safeScenario}_${ts}.${ext}`;
        voiceFolder.file(filename, clip.blob);
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const zipUrl = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = zipUrl;
    a.download = `园区智驾体验分记录_${dateStr}_${timeStr}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(zipUrl);
}

// 重置所有记录
function resetAll() {
    if (!confirm('确定要重置所有记录吗？此操作不可恢复。')) {
        return;
    }
    
    // 清空场景记录
    Object.keys(scenarioRecords).forEach(scenarioName => {
        scenarioRecords[scenarioName] = [];
        const countEl = document.getElementById(`count-${scenarioName}`);
        if (countEl) {
            countEl.textContent = '0';
        }
        updateScenarioScore(scenarioName);
    });
    
    // 清空微行为记录
    Object.keys(behaviorCounts).forEach(behaviorName => {
        behaviorCounts[behaviorName] = 0;
        updateBehaviorDisplay(behaviorName);
    });
    
    // 清空Bonus记录
    Object.keys(bonusCounts).forEach(bonusType => {
        bonusCounts[bonusType] = 0;
        updateBonusDisplay(bonusType);
    });
    
    // 清空事件日志
    eventLogs.length = 0;
    
    // 更新所有分数显示
    updateMicroBehavior();
    updateBonus();
    updateTotalScore();
    
    // 清除localStorage
    localStorage.removeItem('scenarioRecords');
    localStorage.removeItem('behaviorCounts');
    localStorage.removeItem('bonusCounts');
    localStorage.removeItem('eventLogs');

    clearAllAudioClips().catch(() => {});
    
    alert('所有记录已重置！');
}

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', function() {
    // 从localStorage加载数据
    loadFromLocalStorage();

    attachVoiceModalHandlers();
    
    // 初始化所有场景（不再显示单个场景得分）
    Object.keys(scenarioRecords).forEach(scenarioName => {
        updateScenarioScore(scenarioName);
    });
    
    // 初始化微行为显示
    Object.keys(behaviorCounts).forEach(behaviorName => {
        updateBehaviorDisplay(behaviorName);
    });
    
    // 初始化Bonus显示
    Object.keys(bonusCounts).forEach(bonusType => {
        updateBonusDisplay(bonusType);
    });
    
    // 初始化微行为得分
    const microScoreEl = document.getElementById('micro-behavior-total');
    if (microScoreEl) {
        updateMicroBehavior();
    }
    
    // 初始化Bonus得分
    const bonusScoreEl = document.getElementById('bonus-total');
    if (bonusScoreEl) {
        updateBonus();
    }
    
    // 计算并显示所有总分
    updateTotalScore();
    
    // 初始化实时时间显示
    function updateTime() {
        const now = new Date();
        const timeStr = now.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        const timeEl = document.getElementById('current-time');
        if (timeEl) {
            timeEl.textContent = timeStr;
        }
    }
    
    // 立即显示时间
    updateTime();
    
    // 每秒更新一次
    setInterval(updateTime, 1000);
});
