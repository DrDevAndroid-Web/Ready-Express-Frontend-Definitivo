// Selector de país con búsqueda (combobox accesible, patrón WAI-ARIA 1.2).
// Lista completa ISO 3166-1 alfa-2; los nombres se traducen al español con Intl.DisplayNames.

const ISO_CODES = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ",
  "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS",
  "BT", "BV", "BW", "BY", "BZ", "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN",
  "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ", "EC", "EE",
  "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK", "FM", "FO", "FR", "GA", "GB", "GD", "GE", "GF",
  "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY", "HK", "HM",
  "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT", "JE", "JM",
  "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC",
  "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK",
  "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA",
  "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ", "OM", "PA", "PE", "PF", "PG",
  "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU", "RW",
  "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS",
  "ST", "SV", "SX", "SY", "SZ", "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO",
  "TR", "TT", "TV", "TW", "TZ", "UA", "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI",
  "VN", "VU", "WF", "WS", "YE", "YT", "ZA", "ZM", "ZW"
];

const normalize = text => String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

let countriesCache = null;

export function getCountries() {
  if (countriesCache) return countriesCache;
  let names = null;
  try { names = new Intl.DisplayNames(["es"], { type: "region" }); } catch { /* navegador sin Intl.DisplayNames */ }
  countriesCache = ISO_CODES
    .map(code => {
      const name = names?.of(code) || code;
      return { code, name, search: normalize(`${name} ${code}`) };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
  return countriesCache;
}

export function getCountryName(code) {
  return getCountries().find(country => country.code === String(code || "").toUpperCase())?.name || "";
}

// input: <input role="combobox">; hidden: <input type="hidden"> con el código ISO; listbox: <ul role="listbox">
export function setupCountrySelect({ input, hidden, listbox, toggle, onChange }) {
  if (!input || !hidden || !listbox) return null;
  const countries = getCountries();
  let filtered = countries;
  let activeIndex = -1;

  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", listbox.id);
  input.setAttribute("aria-autocomplete", "list");

  function render() {
    if (!filtered.length) {
      listbox.innerHTML = '<li class="country-empty" role="option" aria-disabled="true">No hay países que coincidan</li>';
      return;
    }
    listbox.innerHTML = filtered.map((country, index) => `
      <li id="${listbox.id}-${country.code}" role="option" data-code="${country.code}"
          class="country-option${index === activeIndex ? " is-active" : ""}"
          aria-selected="${country.code === hidden.value}">${country.name}<span class="country-code">${country.code}</span></li>`).join("");
  }

  function open() {
    if (listbox.hidden === false) return;
    listbox.hidden = false;
    input.setAttribute("aria-expanded", "true");
    activeIndex = Math.max(0, filtered.findIndex(country => country.code === hidden.value));
    render();
    scrollActiveIntoView();
  }

  function close() {
    listbox.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    activeIndex = -1;
  }

  function scrollActiveIntoView() {
    const active = filtered[activeIndex];
    if (!active) return input.removeAttribute("aria-activedescendant");
    const el = document.getElementById(`${listbox.id}-${active.code}`);
    input.setAttribute("aria-activedescendant", el?.id || "");
    el?.scrollIntoView({ block: "nearest" });
  }

  function syncValidity() {
    input.setCustomValidity(input.required && !hidden.value ? "Selecciona un país de la lista" : "");
  }

  function select(code, { silent = false } = {}) {
    const country = countries.find(item => item.code === code);
    hidden.value = country?.code || "";
    input.value = country?.name || "";
    syncValidity();
    close();
    if (!silent) onChange?.(hidden.value);
  }

  function filter() {
    const query = normalize(input.value);
    filtered = query ? countries.filter(country => country.search.includes(query)) : countries;
    activeIndex = filtered.length ? 0 : -1;
    // Escribir invalida la selección previa hasta que se elija una opción
    if (hidden.value && getCountryName(hidden.value) !== input.value) {
      hidden.value = "";
      syncValidity();
      onChange?.("");
    }
    if (listbox.hidden) open(); else render();
    scrollActiveIntoView();
  }

  input.addEventListener("input", filter);
  input.addEventListener("focus", () => { filtered = countries; open(); });
  input.addEventListener("click", open);
  input.addEventListener("keydown", event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (listbox.hidden) return open();
      const step = event.key === "ArrowDown" ? 1 : -1;
      activeIndex = Math.min(filtered.length - 1, Math.max(0, activeIndex + step));
      render();
      scrollActiveIntoView();
    } else if (event.key === "Enter") {
      if (!listbox.hidden && filtered[activeIndex]) {
        event.preventDefault();
        select(filtered[activeIndex].code);
      }
    } else if (event.key === "Escape") {
      if (!listbox.hidden) {
        event.preventDefault();
        close();
      }
    } else if (event.key === "Tab" && !listbox.hidden && filtered.length === 1) {
      select(filtered[0].code);
    }
  });
  input.addEventListener("blur", () => {
    // Coincidencia exacta escrita a mano (sin tildes/mayúsculas) cuenta como selección
    if (!hidden.value && input.value.trim()) {
      const exact = countries.find(country => normalize(country.name) === normalize(input.value));
      if (exact) select(exact.code);
    }
    close();
  });

  // mousedown evita que el input pierda el foco antes del click (también cubre el tap en móvil)
  listbox.addEventListener("mousedown", event => event.preventDefault());
  listbox.addEventListener("click", event => {
    const option = event.target.closest("[data-code]");
    if (option) select(option.dataset.code);
  });

  toggle?.addEventListener("mousedown", event => event.preventDefault());
  toggle?.addEventListener("click", () => {
    if (listbox.hidden) {
      input.focus();
      open();
    } else {
      close();
    }
  });

  if (hidden.value) select(hidden.value, { silent: true });
  syncValidity();

  return { select, syncValidity };
}
