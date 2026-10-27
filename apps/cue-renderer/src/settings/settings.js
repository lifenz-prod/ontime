/* global renderer */
const customOption = '__custom__';

const statusText = {
  disabled: 'Off',
  loading: 'Connecting',
  live: 'Live',
  stale: 'No updates from Ontime',
  offline: 'Not connected to Ontime',
  fault: 'Fault',
};

const form = document.getElementById('settings');
const outputsContainer = document.getElementById('outputs');
const template = document.getElementById('output-template');
const saved = document.getElementById('saved');

let sections = [];
let isDirty = false;

function field(section, name) {
  return section.querySelector(`[data-field="${name}"]`);
}

function buildSections(state) {
  outputsContainer.replaceChildren();
  sections = state.config.outputs.map((_, index) => {
    const section = template.content.firstElementChild.cloneNode(true);
    section.querySelector('h2').textContent = `Output ${index + 1}`;

    const select = field(section, 'view');
    for (const view of state.knownViews) {
      select.add(new Option(view.label, view.path));
    }
    select.add(new Option('Custom…', customOption));
    select.addEventListener('change', () => updateCustomVisibility(section));

    for (const [name, limit] of Object.entries(state.limits)) {
      field(section, name).min = limit.min;
      field(section, name).max = limit.max;
    }

    section.querySelector('.reload').addEventListener('click', () => renderer.reload(index));
    outputsContainer.appendChild(section);
    return section;
  });
}

function updateCustomVisibility(section) {
  section.querySelector('.custom-view').hidden = field(section, 'view').value !== customOption;
}

function fillForm(state) {
  form.elements.serverUrl.value = state.config.serverUrl;
  state.config.outputs.forEach((output, index) => {
    const section = sections[index];
    const isKnown = state.knownViews.some((view) => view.path === output.view);
    field(section, 'enabled').checked = output.enabled;
    field(section, 'name').value = output.name;
    field(section, 'view').value = isKnown ? output.view : customOption;
    field(section, 'customView').value = isKnown ? '' : output.view;
    field(section, 'query').value = output.query;
    field(section, 'width').value = output.width;
    field(section, 'height').value = output.height;
    field(section, 'frameRate').value = output.frameRate;
    field(section, 'transparent').checked = output.transparent;
    updateCustomVisibility(section);
  });
  isDirty = false;
}

function readForm() {
  return {
    serverUrl: form.elements.serverUrl.value,
    outputs: sections.map((section) => {
      const view = field(section, 'view').value;
      return {
        enabled: field(section, 'enabled').checked,
        name: field(section, 'name').value,
        view: view === customOption ? field(section, 'customView').value : view,
        query: field(section, 'query').value,
        width: Number(field(section, 'width').value),
        height: Number(field(section, 'height').value),
        frameRate: Number(field(section, 'frameRate').value),
        transparent: field(section, 'transparent').checked,
      };
    }),
  };
}

function showStatus(state) {
  state.outputs.forEach((output, index) => {
    const section = sections[index];
    if (!section) return;
    const status = section.querySelector('.status');
    status.textContent = statusText[output.status] ?? output.status;
    status.dataset.status = output.status;

    const details = [];
    if (output.url) details.push(output.url);
    if (output.status !== 'disabled') {
      details.push(`${output.frameRate} fps published`);
      details.push(output.hasClients ? 'Syphon client connected' : 'No Syphon client connected');
    }
    if (output.lastError) details.push(output.lastError);
    section
      .querySelector('.meta')
      .replaceChildren(...details.map((text) => Object.assign(document.createElement('div'), { textContent: text })));
  });
}

async function refreshPreviews() {
  const previews = await renderer.getPreviews();
  previews.forEach((preview, index) => {
    const image = sections[index]?.querySelector('.preview img');
    if (!image) return;
    image.hidden = !preview;
    if (preview) image.src = preview;
  });
}

form.addEventListener('input', () => {
  isDirty = true;
  saved.textContent = 'Unsaved changes';
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const state = await renderer.save(readForm());
  fillForm(state);
  showStatus(state);
  saved.textContent = 'Saved';
});

renderer.onState((state) => {
  // the form is only refilled from the app when there is nothing typed that it would overwrite
  if (!isDirty) fillForm(state);
  showStatus(state);
});

renderer.getState().then((state) => {
  buildSections(state);
  fillForm(state);
  showStatus(state);
  refreshPreviews();
  setInterval(refreshPreviews, 1000);
});
