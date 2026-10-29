// ===== FOCUS OS — DERS / KONU OTOMATİK TAMAMLAMA =====
// Kayıtlı ders ve konu adlarını (geçmiş çalışmalar, ders programı, görevler,
// planlayıcı, yol haritası) yazarken önerir. Kullanım:
//   - Yazdıkça eşleşen öneriler açılır; ilk öneri satır içinde gri olarak tamamlanır.
//   - Tab / Enter / → : öneriyi kabul eder.  ↑ / ↓ : öneriler arasında gezer.  Esc : kapatır.

const SUBJECT_AUTOCOMPLETE_INPUTS = [
    'studySubjectInput', 'taskName', 'manualTaskName', 'planner-title',
    'endday-first-task', 'priority-1', 'priority-2', 'priority-3'
];
const SUBJECT_SUGGESTION_LIMIT = 8;
const SUBJECT_SOURCE_LABELS = {
    history: 'geçmiş', schedule: 'program', task: 'görev',
    planner: 'plan', roadmap: 'yol haritası', repeat: 'tekrar'
};

let subjectSuggestionCache = null;
let subjectSuggestionPromise = null;

function normalizeForSearch(text) {
    return String(text || '')
        .toLocaleLowerCase('tr-TR')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/ı/g, 'i');
}

function invalidateSubjectSuggestions() {
    subjectSuggestionCache = null;
    subjectSuggestionPromise = null;
}

async function loadSubjectSuggestions() {
    if (subjectSuggestionCache) return subjectSuggestionCache;
    if (!hasPywebviewApi() || !window.pywebview.api.get_subject_suggestions) return [];
    if (!subjectSuggestionPromise) {
        subjectSuggestionPromise = window.pywebview.api.get_subject_suggestions()
            .then(items => {
                subjectSuggestionCache = (items || []).map(item => ({
                    ...item, search: normalizeForSearch(item.name)
                }));
                return subjectSuggestionCache;
            })
            .catch(err => {
                console.error('[Autocomplete] Öneriler alınamadı:', err);
                subjectSuggestionPromise = null;
                return [];
            });
    }
    return subjectSuggestionPromise;
}

function rankSubjectMatches(items, query) {
    const q = normalizeForSearch(query.trim());
    if (!q) return [];
    const prefix = [], wordPrefix = [], contains = [];
    for (const item of items) {
        if (item.search === q) continue; // Zaten tam yazılmış.
        if (item.search.startsWith(q)) prefix.push(item);
        else if (item.search.split(/[\s\-_/.:()]+/).some(w => w.startsWith(q))) wordPrefix.push(item);
        else if (q.length >= 2 && item.search.includes(q)) contains.push(item);
    }
    return [...prefix, ...wordPrefix, ...contains].slice(0, SUBJECT_SUGGESTION_LIMIT);
}

function attachSubjectAutocomplete(input) {
    if (!input || input.dataset.autocompleteReady) return;
    input.dataset.autocompleteReady = '1';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('aria-autocomplete', 'both');

    const wrapper = document.createElement('div');
    wrapper.className = 'ac-wrapper' + (input.id === 'studySubjectInput' ? ' ac-wrapper--subject' : '');
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const ghost = document.createElement('div');
    ghost.className = 'ac-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    wrapper.insertBefore(ghost, input);

    const list = document.createElement('ul');
    list.className = 'ac-list';
    list.setAttribute('role', 'listbox');
    wrapper.appendChild(list);

    let matches = [];
    let activeIndex = -1;

    function syncGhostStyle() {
        const cs = getComputedStyle(input);
        ['font', 'letterSpacing', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom',
         'borderLeftWidth', 'borderRightWidth', 'borderTopWidth', 'borderBottomWidth'].forEach(prop => {
            ghost.style[prop] = cs[prop];
        });
        ghost.style.borderStyle = 'solid';
        ghost.style.borderColor = 'transparent';
        ghost.style.left = input.offsetLeft + 'px';
        ghost.style.top = input.offsetTop + 'px';
        ghost.style.width = input.offsetWidth + 'px';
        ghost.style.height = input.offsetHeight + 'px';
    }

    function close() {
        matches = [];
        activeIndex = -1;
        list.classList.remove('open');
        list.innerHTML = '';
        ghost.textContent = '';
    }

    function updateGhost() {
        ghost.textContent = '';
        const value = input.value;
        const pick = matches[activeIndex >= 0 ? activeIndex : 0];
        if (!pick || !value || input.selectionStart !== value.length) return;
        // Ortalanmış metinde satır içi tamamlama hizalanamaz; yalnızca liste gösterilir.
        if (getComputedStyle(input).textAlign === 'center') return;
        if (!normalizeForSearch(pick.name).startsWith(normalizeForSearch(value))) return;
        syncGhostStyle();
        const typed = document.createElement('span');
        typed.className = 'ac-ghost-typed';
        typed.textContent = value;
        ghost.appendChild(typed);
        ghost.appendChild(document.createTextNode(pick.name.slice(value.length)));
    }

    function render() {
        list.innerHTML = '';
        if (!matches.length) { close(); return; }
        matches.forEach((item, i) => {
            const li = document.createElement('li');
            li.className = 'ac-item' + (i === activeIndex ? ' active' : '');
            li.setAttribute('role', 'option');
            const name = document.createElement('span');
            name.className = 'ac-item-name';
            name.textContent = item.name;
            const src = document.createElement('span');
            src.className = 'ac-item-source';
            src.textContent = SUBJECT_SOURCE_LABELS[item.source] || '';
            li.append(name, src);
            li.addEventListener('mousedown', e => {
                e.preventDefault(); // Odak input'tan çıkmasın.
                accept(item);
            });
            list.appendChild(li);
        });
        list.style.top = (input.offsetTop + input.offsetHeight + 4) + 'px';
        list.style.left = input.offsetLeft + 'px';
        list.style.width = input.offsetWidth + 'px';
        list.classList.add('open');
        updateGhost();
    }

    function accept(item) {
        input.value = item.name;
        close();
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    async function refresh() {
        const query = input.value;
        if (!query.trim()) { close(); return; }
        const items = await loadSubjectSuggestions();
        if (input.value !== query) return; // Bu arada yazmaya devam edildi.
        matches = rankSubjectMatches(items, query);
        activeIndex = -1;
        render();
    }

    input.addEventListener('input', refresh);
    input.addEventListener('focus', () => { loadSubjectSuggestions(); });
    input.addEventListener('blur', () => setTimeout(close, 120));
    input.addEventListener('keydown', e => {
        if (!matches.length) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const dir = e.key === 'ArrowDown' ? 1 : -1;
            activeIndex = (activeIndex + dir + matches.length) % matches.length;
            render();
        } else if (e.key === 'Tab' || (e.key === 'ArrowRight' && input.selectionStart === input.value.length)) {
            const pick = matches[activeIndex >= 0 ? activeIndex : 0];
            if (pick) { e.preventDefault(); accept(pick); }
        } else if (e.key === 'Enter') {
            const pick = activeIndex >= 0 ? matches[activeIndex] : (ghost.textContent ? matches[0] : null);
            if (pick) { e.preventDefault(); e.stopPropagation(); accept(pick); }
        } else if (e.key === 'Escape') {
            close();
        }
    });
    input.addEventListener('scroll', () => { ghost.scrollLeft = input.scrollLeft; });
}

function initSubjectAutocomplete() {
    SUBJECT_AUTOCOMPLETE_INPUTS.forEach(id => attachSubjectAutocomplete(document.getElementById(id)));
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSubjectAutocomplete);
} else {
    initSubjectAutocomplete();
}
// Yeni görev/plan/konu eklenince listeyi tazele.
window.addEventListener('focus', invalidateSubjectSuggestions);
