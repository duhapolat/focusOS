(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.parseQuickRoadmapOutline = api.parseQuickRoadmapOutline;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function cleanOutlineLine(rawLine) {
        return String(rawLine || '')
            .trim()
            .replace(/^#{1,6}\s*/, '')
            .replace(/^>\s*/, '')
            .replace(/^[-+]\s+(?=\d)/, '')
            .replace(/\*\*|__|`/g, '')
            .replace(/\s+#+$/, '')
            .trim();
    }

    function normalizeTitle(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function parseHeading(line) {
        const match = line.match(/^(\d+(?:\.\d+)*)(?:[.)])?\s+(.+)$/);
        if (!match) return null;
        const title = normalizeTitle(match[2].replace(/\*\*|__|`/g, ''));
        if (!title) return null;
        return {
            number: match[1],
            path: match[1].split('.').map(part => parseInt(part, 10)),
            title,
            name: `${match[1]} ${title}`,
            notes: []
        };
    }

    function keyFor(path) {
        return path.join('.');
    }

    function parseQuickRoadmapOutline(rawText, requestedName) {
        const lines = String(rawText || '').replace(/\r/g, '').split('\n');
        const entries = [];
        const seen = new Map();
        let lastEntry = null;
        let duplicateCount = 0;
        let ignoredCount = 0;

        for (const rawLine of lines) {
            const line = cleanOutlineLine(rawLine);
            if (!line) continue;
            const heading = parseHeading(line);
            if (!heading) {
                if (lastEntry) lastEntry.notes.push(line);
                else ignoredCount++;
                continue;
            }

            const duplicateKey = `${heading.number}|${heading.title.toLocaleLowerCase('tr-TR')}`;
            if (seen.has(duplicateKey)) {
                duplicateCount++;
                lastEntry = seen.get(duplicateKey);
                continue;
            }
            seen.set(duplicateKey, heading);
            entries.push(heading);
            lastEntry = heading;
        }

        if (!entries.length) {
            return {
                valid: false,
                error: 'Numaralı bir başlık bulunamadı. Örnek: 1.1 Konu veya 1.1.1 Alt konu',
                subprograms: [],
                counts: {subprograms: 0, phases: 0, topics: 0},
                duplicateCount,
                ignoredCount
            };
        }

        const maxDepth = Math.max(...entries.map(entry => entry.path.length));
        const topicDepth = maxDepth;
        const phaseDepth = Math.max(0, maxDepth - 1);
        const subDepth = Math.max(0, maxDepth - 2);
        const suppliedName = normalizeTitle(requestedName);
        const firstZeroRoot = entries.find(entry =>
            maxDepth >= 3 && entry.path.length === phaseDepth && entry.path.at(-1) === 0
        );
        const firstNaturalRoot = subDepth > 0
            ? entries.find(entry => entry.path.length === subDepth)
            : null;
        const suggestedName = suppliedName || firstZeroRoot?.title || firstNaturalRoot?.title || 'Hızlı Yol Haritası';

        const subprograms = [];
        const subByPrefix = new Map();
        const phaseByPath = new Map();
        const syntheticSubs = new Map();

        function createSubprogram(name, prefixKey, synthetic) {
            const subprogram = {name, icon: synthetic ? '📂' : '🧭', phases: []};
            subprograms.push(subprogram);
            if (prefixKey !== null) subByPrefix.set(prefixKey, subprogram);
            return subprogram;
        }

        function findOrCreateSubprogram(path) {
            if (subDepth > 0) {
                const exact = subByPrefix.get(keyFor(path.slice(0, subDepth)));
                if (exact) return exact;
            }

            if (phaseDepth > 1) {
                const promoted = subByPrefix.get(keyFor(path.slice(0, phaseDepth - 1)));
                if (promoted) return promoted;
            }

            const syntheticKey = subDepth > 0 ? keyFor(path.slice(0, subDepth)) : 'all';
            if (syntheticSubs.has(syntheticKey)) return syntheticSubs.get(syntheticKey);
            const suffix = syntheticKey !== 'all' && !suppliedName ? ` — Bölüm ${syntheticKey}` : '';
            const created = createSubprogram(`${suggestedName}${suffix}`, null, true);
            syntheticSubs.set(syntheticKey, created);
            return created;
        }

        function createPhase(subprogram, name, pathKey) {
            const phase = {name, topics: []};
            subprogram.phases.push(phase);
            if (pathKey) phaseByPath.set(pathKey, phase);
            return phase;
        }

        // Önce açık alt program başlıklarını kaydet. "1.0" aynı seviyedeki 1.1, 1.2...
        // başlıklarının üst grubu olarak kabul edilir.
        for (const entry of entries) {
            const isZeroRoot = maxDepth >= 3 && entry.path.length === phaseDepth && entry.path.at(-1) === 0;
            const isNaturalRoot = subDepth > 0 && entry.path.length === subDepth;
            if (isZeroRoot) {
                createSubprogram(entry.name, keyFor(entry.path.slice(0, phaseDepth - 1)), false);
            } else if (isNaturalRoot) {
                createSubprogram(entry.name, keyFor(entry.path), false);
            }
        }

        for (const entry of entries) {
            const depth = entry.path.length;
            const isZeroRoot = maxDepth >= 3 && depth === phaseDepth && entry.path.at(-1) === 0;
            const isNaturalRoot = subDepth > 0 && depth === subDepth;
            if (isZeroRoot || isNaturalRoot) continue;

            if (phaseDepth > 0 && depth === phaseDepth) {
                const subprogram = findOrCreateSubprogram(entry.path);
                createPhase(subprogram, entry.name, keyFor(entry.path));
                continue;
            }

            if (depth === topicDepth) {
                const subprogram = findOrCreateSubprogram(entry.path);
                const parentPath = phaseDepth > 0 ? entry.path.slice(0, phaseDepth) : [];
                const parentKey = keyFor(parentPath);
                const phaseLookupKey = parentKey || `auto-${subprograms.indexOf(subprogram)}`;
                let phase = phaseByPath.get(phaseLookupKey);
                if (!phase) {
                    const phaseName = phaseDepth > 0 && parentKey
                        ? `Bölüm ${parentKey}`
                        : 'Konular';
                    phase = createPhase(subprogram, phaseName, phaseLookupKey);
                }
                phase.topics.push({
                    title: entry.name,
                    description: entry.notes.join(' ').trim()
                });
            }
        }

        const populatedSubprograms = subprograms
            .map(subprogram => ({
                ...subprogram,
                phases: subprogram.phases.filter(phase => phase.topics.length > 0)
            }))
            .filter(subprogram => subprogram.phases.length > 0);

        const counts = populatedSubprograms.reduce((total, subprogram) => {
            total.subprograms += 1;
            total.phases += subprogram.phases.length;
            total.topics += subprogram.phases.reduce((sum, phase) => sum + phase.topics.length, 0);
            return total;
        }, {subprograms: 0, phases: 0, topics: 0});

        return {
            valid: counts.topics > 0,
            error: counts.topics > 0 ? '' : 'Konu olarak kullanılabilecek en alt seviye bulunamadı.',
            name: suggestedName,
            subprograms: populatedSubprograms,
            counts,
            duplicateCount,
            ignoredCount,
            maxDepth
        };
    }

    return {parseQuickRoadmapOutline, cleanOutlineLine, parseHeading};
});
