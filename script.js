// 场景评分映射：1分(-5), 2分(-2), 3分(0), 4分(+2), 5分(+5)
const SCORE_MAP = {
    1: -5,
    2: -2,
    3: 0,
    4: 2,
    5: 5
};

// 场景初始分
const INITIAL_SCENARIO_SCORE = 60;
const MAX_SCENARIO_SCORE = 100;
const MIN_SCENARIO_SCORE = 0;

// 微行为初始分和扣分
const INITIAL_MICRO_SCORE = 100;
const MICRO_DEDUCTION = 3;

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

// 记录场景评分（直接点击按钮）
function recordScenario(scenarioName, score) {
    const recordId = Date.now() + Math.random(); // 确保唯一ID
    scenarioRecords[scenarioName].push({ id: recordId, score: score, time: new Date() });
    
    // 视觉反馈
    const button = event.target.closest('.score-btn');
    if (button) {
        button.classList.add('clicked');
        setTimeout(() => button.classList.remove('clicked'), 300);
    }
    
    // 更新场景得分（这会触发总分更新）
    updateScenarioScore(scenarioName);
    updateRecentRecords(scenarioName);
    
    // 添加分数更新动画效果
    highlightScoreUpdate();
}

// 删除场景记录
function removeScenarioRecord(scenarioName, recordId) {
    scenarioRecords[scenarioName] = scenarioRecords[scenarioName].filter(r => r.id !== recordId);
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
    '异常降级/退出': 0
};

// 改变微行为次数
function changeBehaviorCount(behaviorName, delta) {
    behaviorCounts[behaviorName] = Math.max(0, behaviorCounts[behaviorName] + delta);
    updateBehaviorDisplay(behaviorName);
    updateMicroBehavior();
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
    bonusCounts[bonusType] = Math.max(0, bonusCounts[bonusType] + delta);
    updateBonusDisplay(bonusType);
    updateBonus();
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
    
    // 计算最终得分：总分 = 0.6*综合场景分 + 0.4*微行为得分 + 用户bonus
    const finalScore = 0.6 * weightedScenarioTotal + 0.4 * microScore + bonusScore;
    
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

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', function() {
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
        microScoreEl.textContent = INITIAL_MICRO_SCORE.toFixed(0);
    }
    
    // 初始化Bonus得分
    const bonusScoreEl = document.getElementById('bonus-total');
    if (bonusScoreEl) {
        bonusScoreEl.textContent = INITIAL_BONUS_SCORE.toFixed(0);
    }
    
    // 计算并显示所有总分
    updateTotalScore();
});
