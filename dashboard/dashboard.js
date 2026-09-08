import { cargarProductos, mostrarModalCrearProducto } from './scripts/cargar-productos.js?v7';

const API_PREDETERMINADA = 'https://readyexpressnowbackend.versabold.com';
const TOKEN_KEY = 're_admin_token';
const REFRESH_TOKEN_KEY = 're_admin_refresh_token';
const EXPIRES_AT_KEY = 're_admin_expires_at';
const CATEGORIES_KEY = 're_product_categories';
let ultimaSync = null;
let sesionActual = null;
let refreshEnCurso = null;
let cargandoPagos = false;
const eventosApi = [];

function obtenerApiBase() {
  return (localStorage.getItem('re_api_url') || API_PREDETERMINADA).replace(/\/$/, '');
}

function obtenerUrlInicialApi() {
  const guardada = localStorage.getItem('re_api_url');
  if (!guardada || guardada.includes('localhost:3000') || guardada.includes('readyexpressnowbackend.versabold.com')) {
    localStorage.setItem('re_api_url', API_PREDETERMINADA);
    return API_PREDETERMINADA;
  }
  return guardada;
}

function guardarConfiguracion() {
  const valor = document.getElementById('entrada-url-api').value.trim();
  if (!valor) return mostrarAviso('Ingresa una URL valida', 'error');

  localStorage.setItem('re_api_url', valor);
  document.getElementById('config-url-activa').textContent = valor;
  mostrarAviso('Configuracion guardada', 'exito');
  actualizarTodo();
}

function registrarApi(mensaje, tipo = 'info') {
  const hora = new Date().toLocaleTimeString('es-VE');
  eventosApi.unshift({ hora, mensaje, tipo });
  if (eventosApi.length > 8) eventosApi.pop();
  renderApiLog();
  if (tipo === 'error') mostrarAviso(mensaje, 'error');
}

function renderApiLog() {
  const contenedor = document.getElementById('api-log');
  if (!contenedor) return;

  if (!eventosApi.length) {
    contenedor.innerHTML = '<div class="fila-log-api">Sin eventos todavia</div>';
    return;
  }

  contenedor.innerHTML = eventosApi.map(evento => `
    <div class="fila-log-api ${evento.tipo}">
      <span>${evento.hora}</span>
      <strong>${evento.mensaje}</strong>
    </div>
  `).join('');
}

function guardarCategoriasProductos(productos = []) {
  const categorias = [...new Set(
    productos
      .map(item => String(item.categoria || '').trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'es'));

  localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categorias));
  renderCategoriasProductos(categorias);
  return categorias;
}

function obtenerCategoriasProductos() {
  try {
    return JSON.parse(localStorage.getItem(CATEGORIES_KEY)) || [];
  } catch {
    return [];
  }
}

function renderCategoriasProductos(categorias = obtenerCategoriasProductos()) {
  const contenedor = document.getElementById('config-categorias-productos');
  if (!contenedor) return;

  if (!categorias.length) {
    contenedor.innerHTML = '<span class="etiqueta categoria-vacia">Sin categorias cargadas</span>';
    return;
  }

  contenedor.innerHTML = categorias
    .map(categoria => `<span class="etiqueta etiqueta-metodo">${categoria}</span>`)
    .join('');
}

async function cargarCategoriasProductos() {
  const productos = await apiFetch('/api/productos');
  return guardarCategoriasProductos(productos || []);
}

function mostrarAviso(mensaje, tipo = '') {
  const aviso = document.getElementById('aviso');
  aviso.textContent = mensaje;
  aviso.className = `aviso mostrar ${tipo}`.trim();
  setTimeout(() => aviso.className = 'aviso', 2500);
}

function cambiarPestana(nombre) {
  document.querySelectorAll('.contenido-pestana').forEach(el => el.classList.remove('activa'));
  document.querySelectorAll('.pestana-nav').forEach(el => el.classList.remove('activa'));
  document.getElementById('contenido-' + nombre).classList.add('activa');
  document.getElementById('pestana-' + nombre).classList.add('activa');
}

function etiquetaEstado(estado) {
  const mapa = {
    pending_review: 'etiqueta-pendiente',
    approved: 'etiqueta-aprobada',
    rejected: 'etiqueta-rechazada',
    paid: 'etiqueta-pagada',
    payment_review: 'etiqueta-revision',
    pending_payment: 'etiqueta-pendiente',
    payment_rejected: 'etiqueta-rechazada',
    awaiting_manual_payment: 'etiqueta-revision',
  };
  const etiquetas = {
    awaiting_manual_payment: 'pago asistido',
    payment_review: 'revision de pago',
    pending_review: 'pendiente',
    pending_payment: 'pendiente',
    payment_rejected: 'rechazado',
    paid: 'pagado',
    approved: 'aprobado',
    rejected: 'rechazado',
  };
  const clase = mapa[estado] || 'etiqueta-generica';
  return `<span class="etiqueta ${clase}">${etiquetas[estado] || estado || 'sin estado'}</span>`;
}

function formatearFecha(fecha) {
  if (!fecha) return '-';
  return new Date(fecha).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' });
}

function idCorto(id) {
  if (!id) return '-';
  return id.substring(0, 8) + '...';
}

async function apiFetch(path, options = {}) {
  const response = await apiFetchRaw(path, options);
  if (response.status === 401 && await renovarSesion()) {
    const retry = await apiFetchRaw(path, options, true);
    if (!retry.ok) throw new Error(retry.data?.error || `HTTP ${retry.status}`);
    return retry.data;
  }

  if (response.status === 401) {
    await cerrarSesion(false);
    throw new Error(response.data?.error || 'Sesion expirada');
  }

  if (!response.ok) throw new Error(response.data?.error || `HTTP ${response.status}`);
  return response.data;
}

async function apiFetchRaw(path, options = {}, silencioso = false) {
  const headers = new Headers(options.headers || {});
  if (sesionActual?.access_token) {
    headers.set('Authorization', `Bearer ${sesionActual.access_token}`);
  }

  const url = obtenerApiBase() + path;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);

  try {
    const respuesta = await fetch(url, {
      ...options,
      headers,
      signal: options.signal || controller.signal
    });
    const contentType = respuesta.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await respuesta.json() : null;

    if (!silencioso) {
      const etiqueta = respuesta.ok ? 'ok' : 'error';
      registrarApi(`${respuesta.status} ${path}${data?.error ? ` - ${data.error}` : ''}`, etiqueta);
    }

    return {
      ok: respuesta.ok,
      status: respuesta.status,
      data
    };
  } catch (err) {
    const mensaje = err.name === 'AbortError'
      ? `Timeout conectando con ${path}`
      : `Conexion cerrada con backend en ${path}`;

    if (!silencioso) {
      registrarApi(`${mensaje}${err.message ? ` - ${err.message}` : ''}`, 'error');
    }

    return {
      ok: false,
      status: 0,
      data: {
        error: mensaje,
        details: err.message || 'Error de red'
      }
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function renovarSesion() {
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!refreshToken) return false;

  if (!refreshEnCurso) {
    refreshEnCurso = fetch(obtenerApiBase() + '/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken })
    })
      .then(async respuesta => {
        const data = await respuesta.json().catch(() => ({}));
        if (!respuesta.ok || !data.access_token) throw new Error(data.error || 'No se pudo renovar sesion');
        guardarSesion(data);
        registrarApi('Sesion renovada', 'ok');
        return true;
      })
      .catch(err => {
        registrarApi(err.message || 'No se pudo renovar sesion', 'error');
        limpiarSesion();
        return false;
      })
      .finally(() => {
        refreshEnCurso = null;
      });
  }

  return refreshEnCurso;
}

function guardarSesion(data) {
  localStorage.setItem(TOKEN_KEY, data.access_token);
  if (data.refresh_token) localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
  if (data.expires_at) localStorage.setItem(EXPIRES_AT_KEY, String(data.expires_at));
  sesionActual = { access_token: data.access_token };
}

function limpiarSesion() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(EXPIRES_AT_KEY);
  sesionActual = null;
}

async function inicializarAuth() {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      mostrarPantallaLogin();
      return false;
    }

    sesionActual = { access_token: token };
    await apiFetch('/api/auth/me');
    aplicarEstadoSesion();
    return true;
  } catch (e) {
    limpiarSesion();
    mostrarPantallaLogin(e.message);
    establecerEstado(false);
    return false;
  }
}

function aplicarEstadoSesion() {
  const autenticado = Boolean(sesionActual?.access_token);
  document.getElementById('pantalla-login').hidden = autenticado;
  document.querySelector('.contenido-principal').hidden = !autenticado;
  document.querySelector('.navegacion').hidden = !autenticado;
  document.querySelector('.grilla-estadisticas').hidden = !autenticado;
  document.getElementById('boton-cerrar-sesion').hidden = !autenticado;
}

function mostrarPantallaLogin(error = '') {
  sesionActual = null;
  aplicarEstadoSesion();
  const errorEl = document.getElementById('error-login');
  if (errorEl) {
    errorEl.textContent = error;
    errorEl.style.display = error ? 'block' : 'none';
  }
}

async function iniciarSesion(evento) {
  evento.preventDefault();

  const form = evento.currentTarget;
  const boton = form.querySelector('[type="submit"]');
  const errorEl = document.getElementById('error-login');

  boton.disabled = true;
  boton.textContent = 'Entrando...';
  if (errorEl) errorEl.style.display = 'none';

  try {
    const respuesta = await fetch(obtenerApiBase() + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: form.email.value.trim(),
        password: form.password.value
      })
    });
    const data = await respuesta.json();

    if (!respuesta.ok || !data.access_token) {
      throw new Error(data.error || 'Credenciales invalidas');
    }

    guardarSesion(data);
    form.reset();
    aplicarEstadoSesion();
    await cargarCategoriasProductos();
    actualizarTodo();
  } catch (e) {
    mostrarPantallaLogin(e.message || 'Credenciales invalidas');
  } finally {
    boton.disabled = false;
    boton.textContent = 'Entrar';
  }
}

async function cerrarSesion(notificar = true) {
  limpiarSesion();
  mostrarPantallaLogin(notificar ? '' : 'Vuelve a iniciar sesion');
}

/* Pagos */
async function cargarPagos({ silencioso = false } = {}) {
  if (cargandoPagos) return;
  cargandoPagos = true;

  const lista = document.getElementById('lista-pagos');
  if (!silencioso) {
    lista.innerHTML = '<div class="cargando">Cargando pagos...</div>';
  }

  try {
    const data = await apiFetch('/api/payments/pending');
    document.getElementById('estadistica-pendientes').textContent = data.length;
    document.getElementById('contador-pagos').textContent = data.length;

    if (!data.length) {
      lista.innerHTML = '<div class="vacio"><div class="icono-vacio">OK</div>Sin pagos pendientes</div>';
      return;
    }

    lista.innerHTML = data.map(p => {
      const urlImagen = obtenerUrlImagenPago(p.image_url);

      const htmlImagen = urlImagen
        ? `<div class="contenedor-imagen-pago"><img src="${urlImagen}" alt="comprobante" data-imagen-pago></div>`
        : '<div class="contenedor-imagen-pago"><div class="marcador-imagen">sin imagen</div></div>';

      const infoOrden = p.orders
        ? `<div class="fila-info"><span class="clave-info">cliente</span><span class="valor-info">${p.orders.customer_name || 'sin nombre'}</span></div>
           <div class="fila-info"><span class="clave-info">tel</span><span class="valor-info">${p.orders.customer_phone || '-'}</span></div>`
        : '';

      return `
      <div class="tarjeta" id="tarjeta-pago-${p.id}">
        <div class="encabezado-tarjeta">
          <div>
            <div class="id-tarjeta"># ${idCorto(p.id)}</div>
            <div class="titulo-tarjeta">${p.method || 'Metodo desconocido'}</div>
          </div>
          <div class="monto-tarjeta">$${Number(p.amount).toFixed(2)}</div>
        </div>
        <div class="meta-tarjeta">
          ${etiquetaEstado(p.validation_status)}
          <span class="etiqueta etiqueta-generica">${formatearFecha(p.created_at)}</span>
          <span class="etiqueta etiqueta-metodo">orden: ${idCorto(p.order_id)}</span>
        </div>
        ${htmlImagen}
        ${infoOrden ? `<div class="tarjeta-configuracion tarjeta-info-orden">${infoOrden}</div>` : ''}
        <div class="acciones-tarjeta">
          <button class="boton boton-aprobar" data-accion-pago="approve" data-id-pago="${p.id}">Aprobar</button>
          <button class="boton boton-rechazar" data-accion-pago="reject" data-id-pago="${p.id}">Rechazar</button>
        </div>
      </div>`;
    }).join('');

    registrarErroresImagen(lista);
    establecerEstado(true);
  } catch (e) {
    lista.innerHTML = `<div class="vacio"><div class="icono-vacio">!</div>Error al cargar pagos<br><small>${e.message || 'Error desconocido'}</small></div>`;
    establecerEstado(false);
  } finally {
    cargandoPagos = false;
  }
}

function obtenerUrlImagenPago(imageUrl) {
  if (!imageUrl) return null;
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  return `${obtenerApiBase()}/uploads/${imageUrl}`;
}

function registrarErroresImagen(contenedor) {
  contenedor.querySelectorAll('[data-imagen-pago]').forEach(img => {
    img.addEventListener('error', () => {
      img.parentElement.innerHTML = '<div class="marcador-imagen">imagen no disponible</div>';
    });
  });
}

async function verificarPago(id, accion, boton) {
  boton.disabled = true;
  boton.textContent = '...';

  try {
    const data = await apiFetch(`/api/payments/${id}/verify`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: accion })
    });

    mostrarAviso(data.message, accion === 'approve' ? 'exito' : 'error');

    const tarjeta = document.getElementById('tarjeta-pago-' + id);
    tarjeta.style.opacity = '0.4';
    tarjeta.style.transition = 'opacity 0.4s';
    setTimeout(() => { tarjeta.remove(); cargarPagos(); }, 600);
  } catch (e) {
    mostrarAviso('Error: ' + e.message, 'error');
    boton.disabled = false;
    boton.textContent = accion === 'approve' ? 'Aprobar' : 'Rechazar';
  }
}

/* Ordenes */
async function cargarOrdenes() {
  const lista = document.getElementById('lista-ordenes');
  lista.innerHTML = '<div class="cargando">Cargando ordenes...</div>';

  try {
    const data = await apiFetch('/api/orders');

    document.getElementById('estadistica-ordenes').textContent = data.length || '-';
    document.getElementById('contador-ordenes').textContent = data.length || 0;

    const aprobadas = data.filter(o => o.status === 'paid');
    const recaudado = aprobadas.reduce((s, o) => s + Number(o.total || 0), 0);
    document.getElementById('estadistica-aprobados').textContent = aprobadas.length;
    document.getElementById('estadistica-recaudado').textContent = '$' + recaudado.toFixed(2);

    if (!data.length) {
      lista.innerHTML = '<div class="vacio"><div class="icono-vacio">0</div>Sin ordenes aun</div>';
      return;
    }

    lista.innerHTML = data.map(o => {
      const items = Array.isArray(o.items)
        ? o.items.map(i => `${i.cantidad}x ${i.nombre} - $${Number(i.precio).toFixed(2)}`).join('\n')
        : JSON.stringify(o.items);

      return `
      <div class="tarjeta">
        <div class="encabezado-tarjeta">
          <div>
            <div class="id-tarjeta"># ${idCorto(o.id)}</div>
            <div class="titulo-tarjeta">${o.customer_name || 'Cliente sin nombre'}</div>
          </div>
          <div class="monto-tarjeta">$${Number(o.total).toFixed(2)}</div>
        </div>
        <div class="meta-tarjeta">
          ${etiquetaEstado(o.status)}
          <span class="etiqueta etiqueta-generica">${formatearFecha(o.created_at)}</span>
        </div>
        ${o.items ? `<div class="items-orden">${items}</div>` : ''}
        <div class="fila-info">
          <span class="clave-info">email</span>
          <span class="valor-info">${o.customer_email || '-'}</span>
        </div>
        <div class="fila-info">
          <span class="clave-info">telefono</span>
          <span class="valor-info">${o.customer_phone || '-'}</span>
        </div>
        <div class="acciones-tarjeta">
          <button class="boton boton-aprobar" data-accion-orden="print" data-id-orden="${o.id}">Imprimir factura</button>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    document.getElementById('estadistica-ordenes').textContent = '-';
    document.getElementById('contador-ordenes').textContent = 0;
    lista.innerHTML = `<div class="vacio"><div class="icono-vacio">!</div>No se pudieron cargar las ordenes<br><small>${e.message || 'Error desconocido'}</small></div>`;
    establecerEstado(false);
  }
}

/* Estado */
function establecerEstado(ok) {
  const punto = document.getElementById('punto-estado');
  const texto = document.getElementById('texto-estado');
  punto.style.background = ok ? 'var(--green)' : 'var(--red)';
  texto.textContent = ok ? 'conectado' : 'sin conexion';
  ultimaSync = new Date();
  document.getElementById('config-ultima-sync').textContent = ultimaSync.toLocaleTimeString('es-VE');
  document.getElementById('config-estado').textContent = ok ? 'Online' : 'Offline';
}

function actualizarTodo() {
  cargarPagos();
  cargarOrdenes();
  cargarProductos(apiFetch, guardarCategoriasProductos);
  cargarMetodosPago();
}

function registrarEventos() {
  document.querySelectorAll('.pestana-nav').forEach(boton => {
    boton.addEventListener('click', () => cambiarPestana(boton.dataset.pestana));
  });

  document.getElementById('boton-actualizar-pagos').addEventListener('click', cargarPagos);
  document.getElementById('boton-actualizar-ordenes').addEventListener('click', cargarOrdenes);
  document.getElementById('boton-actualizar-productos').addEventListener('click', () => cargarProductos(apiFetch, guardarCategoriasProductos));
  document.getElementById('boton-guardar-configuracion').addEventListener('click', guardarConfiguracion);
  document.getElementById('boton-probar-api')?.addEventListener('click', probarConexionApi);
  document.getElementById('formulario-login').addEventListener('submit', iniciarSesion);
  document.getElementById('boton-cerrar-sesion').addEventListener('click', () => cerrarSesion());

  document.querySelectorAll('.subtab-prod').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.subtab-prod').forEach(b => b.classList.remove('activa'));
      document.querySelectorAll('.subtab-prod-content').forEach(c => c.classList.add('subtab-prod-oculto'));
      btn.classList.add('activa');
      document.getElementById('subtab-prod-' + btn.dataset.subtabProd)?.classList.remove('subtab-prod-oculto');
    });
  });

  document.getElementById('lista-pagos').addEventListener('click', evento => {
    const boton = evento.target.closest('[data-accion-pago]');
    if (!boton) return;
    verificarPago(boton.dataset.idPago, boton.dataset.accionPago, boton);
  });

  document.getElementById('lista-ordenes').addEventListener('click', evento => {
    const boton = evento.target.closest('[data-accion-orden="print"]');
    if (!boton) return;
    imprimirOrden(boton.dataset.idOrden, boton);
  });

  document.querySelectorAll('[data-section]').forEach(boton => {
    boton.addEventListener('click', () => {
      mostrarModalCrearProducto(boton.dataset.section, apiFetch, () => cargarProductos(apiFetch, guardarCategoriasProductos));
    });
  });

  // Event listeners para métodos de pago
  document.getElementById('boton-actualizar-metodos')?.addEventListener('click', cargarMetodosPago);
  document.getElementById('boton-anadir-metodo')?.addEventListener('click', () => abrirModalMetodoPago());
  document.getElementById('cerrar-modal-metodo')?.addEventListener('click', cerrarModalMetodoPago);
  document.getElementById('cancelar-modal-metodo')?.addEventListener('click', cerrarModalMetodoPago);
  document.getElementById('formulario-metodo-pago')?.addEventListener('submit', guardarMetodoPago);
}

async function imprimirOrden(id, boton) {
  if (!id) return;
  const textoOriginal = boton.textContent;
  boton.disabled = true;
  boton.textContent = 'Imprimiendo...';

  try {
    const data = await apiFetch(`/api/orders/${encodeURIComponent(id)}/print`, {
      method: 'POST'
    });
    mostrarAviso(data.message || 'Orden enviada a imprimir', 'exito');
  } catch (e) {
    mostrarAviso('Error imprimiendo: ' + (e.message || 'desconocido'), 'error');
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}

async function probarConexionApi() {
  try {
    await apiFetch('/api/auth/config');
    if (sesionActual?.access_token) {
      await apiFetch('/api/auth/me');
      await apiFetch('/api/orders');
      await apiFetch('/api/payments/pending');
    }
    establecerEstado(true);
  } catch (e) {
    registrarApi(e.message || 'Fallo de conexion', 'error');
    establecerEstado(false);
  }
}

/* ════════ Métodos de Pago ════════ */
async function cargarMetodosPago() {
  try {
    const respuesta = await apiFetch('/api/payment-methods');
    const metodos = respuesta.data || respuesta || [];

    const contenedor = document.getElementById('lista-metodos-pago');
    if (!contenedor) return;

    if (!metodos.length) {
      contenedor.innerHTML = '<div class="cargando">No hay métodos de pago configurados</div>';
      return;
    }

    contenedor.innerHTML = metodos
      .sort((a, b) => (a.order_index || 999) - (b.order_index || 999))
      .map(metodo => `
        <div class="tarjeta-metodo-pago ${!metodo.is_active ? 'inactivo' : ''}">
          <div class="encabezado-metodo">
            <div>
              <strong>${escapeHtml(metodo.method_name)}</strong>
              <span class="estado-metodo">${metodo.is_active ? '✓ Activo' : '✗ Inactivo'}</span>
            </div>
            <div style="display: flex; gap: 8px;">
              <button class="boton-editar" onclick="editarMetodoPago(${escapeHtml(JSON.stringify(metodo))})">Editar</button>
              <button class="boton-eliminar" onclick="eliminarMetodoPago('${escapeHtml(metodo.id)}')">Eliminar</button>
            </div>
          </div>
          ${metodo.image_url ? `<img src="${escapeHtml(metodo.image_url)}" alt="${escapeHtml(metodo.method_name)}" style="max-width: 200px; margin: 8px 0;">` : ''}
          <div class="detalle-metodo">
            ${metodo.account_number ? `<div><strong>Cuenta:</strong> ${escapeHtml(metodo.account_number)}</div>` : ''}
            ${metodo.instructions ? `<div><strong>Instrucciones:</strong> ${escapeHtml(metodo.instructions)}</div>` : ''}
          </div>
        </div>
      `).join('');
  } catch (err) {
    console.error('Error cargando métodos:', err);
    registrarApi('Error cargando métodos de pago', 'error');
  }
}

function abrirModalMetodoPago(metodo = null) {
  const modal = document.getElementById('modal-metodo-pago');
  const formulario = document.getElementById('formulario-metodo-pago');
  const titulo = document.getElementById('titulo-modal-metodo');

  formulario.reset();
  document.getElementById('metodo-id').value = '';

  if (metodo) {
    titulo.textContent = `Editar: ${metodo.method_name}`;
    document.getElementById('metodo-id').value = metodo.id || '';
    document.getElementById('metodo-nombre').value = metodo.method_name || '';
    document.getElementById('metodo-cuenta').value = metodo.account_number || '';
    document.getElementById('metodo-instrucciones').value = metodo.instructions || '';
    document.getElementById('metodo-imagen').value = metodo.image_url || '';
    document.getElementById('metodo-activo').checked = metodo.is_active !== false;
  } else {
    titulo.textContent = 'Nuevo método de pago';
    document.getElementById('metodo-activo').checked = true;
  }

  modal.hidden = false;
}

function cerrarModalMetodoPago() {
  document.getElementById('modal-metodo-pago').hidden = true;
}

async function guardarMetodoPago(e) {
  e.preventDefault();

  const id = document.getElementById('metodo-id').value;
  const datos = {
    method_name: document.getElementById('metodo-nombre').value.trim(),
    account_number: document.getElementById('metodo-cuenta').value.trim(),
    instructions: document.getElementById('metodo-instrucciones').value.trim(),
    image_url: document.getElementById('metodo-imagen').value.trim() || null,
    is_active: document.getElementById('metodo-activo').checked
  };

  if (!datos.method_name || !datos.instructions) {
    mostrarAviso('Completa los campos requeridos', 'error');
    return;
  }

  try {
    if (id) {
      await apiFetch(`/api/payment-methods/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(datos)
      });
      mostrarAviso('Método actualizado', 'exito');
    } else {
      await apiFetch('/api/payment-methods', {
        method: 'POST',
        body: JSON.stringify(datos)
      });
      mostrarAviso('Método creado', 'exito');
    }
    cerrarModalMetodoPago();
    cargarMetodosPago();
  } catch (err) {
    mostrarAviso(err.message || 'Error guardando método', 'error');
  }
}

async function eliminarMetodoPago(id) {
  if (!confirm('¿Estás seguro de que deseas eliminar este método de pago?')) return;

  try {
    await apiFetch(`/api/payment-methods/${id}`, { method: 'DELETE' });
    mostrarAviso('Método eliminado', 'exito');
    cargarMetodosPago();
  } catch (err) {
    mostrarAviso(err.message || 'Error eliminando método', 'error');
  }
}

window.editarMetodoPago = function(metodo) {
  abrirModalMetodoPago(metodo);
};

window.eliminarMetodoPago = function(id) {
  eliminarMetodoPago(id);
};

/* Inicio */
window.addEventListener('DOMContentLoaded', async () => {
  const guardada = obtenerUrlInicialApi();
  document.getElementById('entrada-url-api').value = guardada;
  document.getElementById('config-url-activa').textContent = guardada;
  registrarEventos();
  renderApiLog();
  const autenticado = await inicializarAuth();
  renderCategoriasProductos();
  if (autenticado) {
    await cargarCategoriasProductos();
    actualizarTodo();
  }
});

setInterval(() => {
  if (sesionActual?.access_token) cargarPagos({ silencioso: true });
}, 30000);
