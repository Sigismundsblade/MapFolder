const state = {
  report: null,
  cy: null,
  activeLanguages: new Set(),
  activeEdgeTypes: new Set(['imports', 'depends_on', 'references']),
  activeLayout: 'breadthfirst',
};

const LANGUAGE_COLORS = {
  javascript: '#7db7ff',
  typescript: '#84d7a2',
  python: '#f2c572',
  java: '#b69cff',
};

const EDGE_LABELS = {
  imports: 'Imports',
  depends_on: 'Dependencies',
  references: 'References',
};

const summaryGrid = document.getElementById('summary-grid');
const projectPath = document.getElementById('project-path');
const scanStatus = document.getElementById('scan-status');
const languageFilters = document.getElementById('language-filters');
const edgeFilters = document.getElementById('edge-filters');
const searchInput = document.getElementById('search-input');
const detailsPanel = document.getElementById('details-panel');
const graphCaption = document.getElementById('graph-caption');
const graphElement = document.getElementById('graph');
const fileList = document.getElementById('file-list');
const fileCountLabel = document.getElementById('file-count-label');
const fitButton = document.getElementById('fit-button');
const resetButton = document.getElementById('reset-button');
const languageReset = document.getElementById('language-reset');
const layoutButtons = Array.from(document.querySelectorAll('.layout-button'));

initialize().catch((error) => {
  scanStatus.textContent = 'Error';
  graphCaption.textContent = 'Could not load project data.';
  detailsPanel.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
});

async function initialize() {
  const response = await fetch('/api/report');
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}.`);
  }

  state.report = await response.json();
  state.activeLanguages = new Set(Object.keys(state.report.statsByLanguage || inferLanguageStats(state.report)));

  projectPath.textContent = state.report.rootPath;
  scanStatus.textContent = `Updated ${formatDate(state.report.generatedAt)}`;

  renderSummary(state.report);
  renderLanguageFilters(state.report);
  renderEdgeFilters();
  initializeGraph(state.report);
  bindEvents();
  applyFilters();
}

function inferLanguageStats(report) {
  return report.files.reduce((accumulator, file) => {
    accumulator[file.language] = (accumulator[file.language] || 0) + 1;
    return accumulator;
  }, {});
}

function renderSummary(report) {
  const cards = [
    ['Files', report.stats.fileCount],
    ['Dependencies', report.stats.dependencyCount],
    ['Relationships', report.edges.length],
    ['Skipped', report.stats.skippedFileCount],
    ['Languages', report.stats.languageCount],
    ['Scanned', formatBytes(report.stats.scannedBytes)],
  ];

  summaryGrid.innerHTML = cards
    .map(
      ([label, value]) => `
        <div class="stat-row">
          <span>${label}</span>
          <strong>${value}</strong>
        </div>
      `,
    )
    .join('');
}

function renderLanguageFilters(report) {
  const languageCounts = inferLanguageStats(report);
  const languages = Object.keys(languageCounts).sort();

  languageFilters.innerHTML = languages
    .map((language) => {
      const label = language.charAt(0).toUpperCase() + language.slice(1);
      return `
        <label class="checkbox-item">
          <input type="checkbox" data-language="${language}" checked />
          <span>${label}</span>
          <span class="muted">${languageCounts[language]}</span>
        </label>
      `;
    })
    .join('');
}

function renderEdgeFilters() {
  edgeFilters.innerHTML = Object.entries(EDGE_LABELS)
    .map(
      ([key, label]) => `
        <label class="checkbox-item">
          <input type="checkbox" data-edge-type="${key}" checked />
          <span>${label}</span>
        </label>
      `,
    )
    .join('');
}

function initializeGraph(report) {
  const elements = [
    ...report.nodes.map((node) => ({
      group: 'nodes',
      data: {
        ...node,
        searchText: `${node.label} ${node.relativePath || ''} ${node.language || ''}`.toLowerCase(),
      },
    })),
    ...report.edges.map((edge) => ({
      group: 'edges',
      data: {
        ...edge,
        searchText: `${edge.type} ${edge.details.join(' ')}`.toLowerCase(),
      },
    })),
  ];

  state.cy = cytoscape({
    container: graphElement,
    elements,
    style: [
      {
        selector: 'node',
        style: {
          label: 'data(label)',
          'font-size': 11,
          color: '#e8edf5',
          'text-wrap': 'wrap',
          'text-max-width': 220,
          'background-color': '#7db7ff',
          'border-width': 1,
          'border-color': '#d9e5ff',
          'text-valign': 'center',
          'text-halign': 'center',
          shape: 'round-rectangle',
          width: 'label',
          height: 'label',
          padding: '10px',
        },
      },
      {
        selector: 'node[type = "file"][language = "javascript"]',
        style: { 'background-color': LANGUAGE_COLORS.javascript },
      },
      {
        selector: 'node[type = "file"][language = "typescript"]',
        style: { 'background-color': LANGUAGE_COLORS.typescript },
      },
      {
        selector: 'node[type = "file"][language = "python"]',
        style: { 'background-color': LANGUAGE_COLORS.python },
      },
      {
        selector: 'node[type = "file"][language = "java"]',
        style: { 'background-color': LANGUAGE_COLORS.java },
      },
      {
        selector: 'node[type = "dependency"]',
        style: {
          shape: 'round-rectangle',
          'background-color': '#ffb86b',
          'border-color': '#ffe2b6',
          width: 'label',
          height: 'label',
          padding: '10px',
        },
      },
      {
        selector: 'edge',
        style: {
          width: 'mapData(weight, 1, 8, 1.4, 4.2)',
          'curve-style': 'bezier',
          'target-arrow-shape': 'triangle',
          'arrow-scale': 0.9,
          opacity: 0.74,
          'line-color': '#7db7ff',
          'target-arrow-color': '#7db7ff',
        },
      },
      {
        selector: 'edge[type = "depends_on"]',
        style: {
          'line-color': '#f2c572',
          'target-arrow-color': '#f2c572',
        },
      },
      {
        selector: 'edge[type = "references"]',
        style: {
          'line-color': '#b69cff',
          'target-arrow-color': '#b69cff',
          'line-style': 'dashed',
        },
      },
      {
        selector: '.is-hidden',
        style: {
          display: 'none',
        },
      },
      {
        selector: '.is-muted',
        style: {
          opacity: 0.15,
        },
      },
      {
        selector: ':selected',
        style: {
          'border-width': 3,
          'border-color': '#ffffff',
          'line-color': '#ffffff',
          'target-arrow-color': '#ffffff',
          opacity: 1,
        },
      },
    ],
    layout: {
      name: 'breadthfirst',
      animate: false,
      directed: true,
      spacingFactor: 1.2,
      padding: 42,
    },
  });

  state.cy.on('select', 'node', (event) => renderNodeDetails(event.target.data()));
  state.cy.on('select', 'edge', (event) => renderEdgeDetails(event.target.data()));
  state.cy.on('unselect', () => {
    if (state.cy.$(':selected').length === 0) {
      syncFileSelection();
      renderEmptyDetails();
    }
  });
}

function bindEvents() {
  searchInput.addEventListener('input', applyFilters);

  languageFilters.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    const language = target.dataset.language;
    if (!language) {
      return;
    }

    if (target.checked) {
      state.activeLanguages.add(language);
    } else {
      state.activeLanguages.delete(language);
    }
    applyFilters();
  });

  edgeFilters.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    const edgeType = target.dataset.edgeType;
    if (!edgeType) {
      return;
    }

    if (target.checked) {
      state.activeEdgeTypes.add(edgeType);
    } else {
      state.activeEdgeTypes.delete(edgeType);
    }
    applyFilters();
  });

  languageReset.addEventListener('click', () => {
    state.activeLanguages = new Set(Array.from(languageFilters.querySelectorAll('[data-language]')).map((input) => input.dataset.language));
    languageFilters.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.checked = true;
    });
    applyFilters();
  });

  layoutButtons.forEach((button) => {
    button.addEventListener('click', () => {
      state.activeLayout = button.dataset.layout;
      layoutButtons.forEach((item) => item.classList.toggle('is-active', item === button));
      runLayout();
    });
  });

  fitButton.addEventListener('click', () => {
    state.cy.fit(state.cy.elements(':visible'), 40);
  });

  resetButton.addEventListener('click', () => {
    state.cy.$(':selected').unselect();
    syncFileSelection();
    renderEmptyDetails();
    state.cy.fit(state.cy.elements(':visible'), 40);
  });

  fileList.addEventListener('click', (event) => {
    const row = event.target.closest('[data-node-id]');
    if (!row) {
      return;
    }

    selectNodeById(row.dataset.nodeId);
  });
}

function applyFilters() {
  if (!state.cy || !state.report) {
    return;
  }

  const query = searchInput.value.trim().toLowerCase();
  const report = state.report;
  const nodeById = new Map(report.nodes.map((node) => [node.id, node]));
  const visibleNodes = new Set();

  for (const node of report.nodes) {
    if (node.type === 'file') {
      const languageMatch = state.activeLanguages.has(node.language);
      const searchMatch = !query || `${node.label} ${node.relativePath} ${node.language}`.toLowerCase().includes(query);
      if (languageMatch && searchMatch) {
        visibleNodes.add(node.id);
      }
      continue;
    }

    const dependencyMatch = !query || node.label.toLowerCase().includes(query);
    if (dependencyMatch) {
      visibleNodes.add(node.id);
    }
  }

  const visibleEdges = new Set();
  for (const edge of report.edges) {
    if (!state.activeEdgeTypes.has(edge.type)) {
      continue;
    }

    const sourceVisible = visibleNodes.has(edge.source);
    const targetVisible = visibleNodes.has(edge.target);
    if (sourceVisible && targetVisible) {
      visibleEdges.add(edge.id);
      continue;
    }

    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    if ((sourceVisible && targetNode?.type === 'dependency') || (targetVisible && sourceNode?.type === 'dependency')) {
      visibleNodes.add(edge.source);
      visibleNodes.add(edge.target);
      visibleEdges.add(edge.id);
    }
  }

  state.cy.nodes().forEach((node) => {
    node.toggleClass('is-hidden', !visibleNodes.has(node.id()));
  });

  state.cy.edges().forEach((edge) => {
    edge.toggleClass('is-hidden', !visibleEdges.has(edge.id()));
  });

  graphCaption.textContent = `${visibleNodes.size} nodes, ${visibleEdges.size} relationships`;
  renderFileList(report, visibleNodes);
  syncFileSelection();
  runLayout();
}

function runLayout() {
  if (!state.cy) {
    return;
  }

  state.cy.layout({
    name: state.activeLayout,
    animate: false,
    fit: true,
    padding: 42,
    idealEdgeLength: 120,
    nodeRepulsion: 12000,
    spacingFactor: 1.15,
  }).run();
}

function renderNodeDetails(nodeData) {
  const report = state.report;
  const file = report.files.find((entry) => entry.id === nodeData.id);
  const dependency = report.dependencies.find((entry) => entry.id === nodeData.id);
  syncFileSelection(nodeData.id);

  if (file) {
    const relatedEdges = report.edges.filter((edge) => edge.source === file.id || edge.target === file.id).slice(0, 8);
    detailsPanel.innerHTML = `
      <article class="detail-card">
        <div>
          <p class="eyebrow">File</p>
          <h3>${escapeHtml(file.relativePath)}</h3>
        </div>
        <div class="detail-metadata">
          <div><span>Language</span><strong>${escapeHtml(file.language)}</strong></div>
          <div><span>Lines</span><strong>${file.lineCount}</strong></div>
          <div><span>Imports</span><strong>${file.imports.length}</strong></div>
          <div><span>Symbols</span><strong>${file.declaredSymbols.length}</strong></div>
        </div>
      </article>
      <article class="detail-card">
        <h3>Declared Symbols</h3>
        <div>${renderChips(file.declaredSymbols.map((symbol) => `${symbol.name} · ${symbol.kind}`))}</div>
      </article>
      <article class="detail-card">
        <h3>Imports</h3>
        <div>${renderChips(file.imports.map((entry) => entry.specifier || entry.dependencyName))}</div>
      </article>
      <article class="detail-card">
        <h3>Reference Tokens</h3>
        <div>${renderChips(file.referencedTokens.slice(0, 24))}</div>
      </article>
      <article class="detail-card">
        <h3>Related Connections</h3>
        <div>${renderChips(relatedEdges.map((edge) => describeEdge(edge, report.nodes)))}</div>
      </article>
    `;
    return;
  }

  if (dependency) {
    detailsPanel.innerHTML = `
      <article class="detail-card">
        <div>
          <p class="eyebrow">Dependency</p>
          <h3>${escapeHtml(dependency.name)}</h3>
        </div>
        <div class="detail-metadata">
          <div><span>Importers</span><strong>${dependency.importers}</strong></div>
          <div><span>Node Type</span><strong>external</strong></div>
        </div>
      </article>
    `;
    syncFileSelection();
  }
}

function renderEdgeDetails(edgeData) {
  const sourceNode = state.report.nodes.find((node) => node.id === edgeData.source);
  const targetNode = state.report.nodes.find((node) => node.id === edgeData.target);
  syncFileSelection();

  detailsPanel.innerHTML = `
    <article class="detail-card">
      <div>
        <p class="eyebrow">Relationship</p>
        <h3>${escapeHtml(EDGE_LABELS[edgeData.type] || edgeData.type)}</h3>
      </div>
      <div class="detail-metadata">
        <div><span>Source</span><strong>${escapeHtml(sourceNode?.relativePath || sourceNode?.label || edgeData.source)}</strong></div>
        <div><span>Target</span><strong>${escapeHtml(targetNode?.relativePath || targetNode?.label || edgeData.target)}</strong></div>
        <div><span>Weight</span><strong>${edgeData.weight}</strong></div>
        <div><span>Hints</span><strong>${edgeData.details.length}</strong></div>
      </div>
    </article>
    <article class="detail-card">
      <h3>Evidence</h3>
      <div>${renderChips(edgeData.details)}</div>
    </article>
  `;
}

function renderEmptyDetails() {
  detailsPanel.innerHTML = '<p class="muted">Select a node or relationship to inspect its metadata.</p>';
}

function renderFileList(report, visibleNodes) {
  const files = report.nodes
    .filter((node) => node.type === 'file' && visibleNodes.has(node.id))
    .sort((left, right) => {
      const byImports = (right.importCount || 0) - (left.importCount || 0);
      if (byImports !== 0) {
        return byImports;
      }
      return left.relativePath.localeCompare(right.relativePath);
    });

  fileCountLabel.textContent = `${files.length} visible`;

  if (files.length === 0) {
    fileList.innerHTML = '<p class="muted">No files match the current filters.</p>';
    return;
  }

  fileList.innerHTML = files
    .map(
      (file) => `
        <button class="file-row" type="button" data-node-id="${file.id}">
          <span class="file-row-title">
            <span>${escapeHtml(file.label)}</span>
            <span>${escapeHtml(file.language)}</span>
          </span>
          <span class="file-row-path">${escapeHtml(file.relativePath)}</span>
          <span class="file-row-meta">
            <span>${file.importCount || 0} imports</span>
            <span>${file.symbolCount || 0} symbols</span>
            <span>${file.lineCount || 0} lines</span>
          </span>
        </button>
      `,
    )
    .join('');
}

function selectNodeById(nodeId) {
  if (!state.cy) {
    return;
  }

  const target = state.cy.getElementById(nodeId);
  if (!target || target.length === 0) {
    return;
  }

  state.cy.$(':selected').unselect();
  target.select();
  state.cy.center(target);
  syncFileSelection(nodeId);
}

function syncFileSelection(activeNodeId) {
  fileList.querySelectorAll('[data-node-id]').forEach((row) => {
    row.classList.toggle('is-active', row.dataset.nodeId === activeNodeId);
  });
}

function describeEdge(edge, nodes) {
  const sourceNode = nodes.find((node) => node.id === edge.source);
  const targetNode = nodes.find((node) => node.id === edge.target);
  const sourceLabel = sourceNode?.relativePath || sourceNode?.label || edge.source;
  const targetLabel = targetNode?.relativePath || targetNode?.label || edge.target;
  return `${sourceLabel} -> ${targetLabel} (${EDGE_LABELS[edge.type] || edge.type})`;
}

function renderChips(values) {
  if (!values || values.length === 0) {
    return '<p class="muted">No data available for this selection.</p>';
  }

  return values
    .filter(Boolean)
    .map((value) => `<span class="detail-chip">${escapeHtml(String(value))}</span>`)
    .join('');
}

function formatDate(value) {
  return new Date(value).toLocaleString();
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
