/* Productos */
const CATEGORIES_KEY = 're_product_categories';
const CATEGORY_FILTER_KEY = 're_product_category_filter';
const NEW_CATEGORY_VALUE = '__new_category__';

export async function cargarProductos(apiFetch, onCategoriasProductos) {
  await Promise.all([
    cargarCombos(apiFetch, '/api/combos-comida', 'lista-combos-comida'),
    cargarListaProductos(apiFetch, '/api/productos', 'lista-productos', onCategoriasProductos),
    cargarListaProductos(apiFetch, '/api/electrodomesticos', 'lista-electro')
  ]);
}

export function mostrarModalCrearProducto(section, apiFetch, recargar) {
  if (section === 'combos') {
    mostrarModalCrearCombo(apiFetch, recargar);
    return;
  }

  const config = section === 'electro'
    ? obtenerConfigProducto('/api/electrodomesticos', 'lista-electro')
    : obtenerConfigProducto('/api/productos', 'lista-productos');

  mostrarModalCrearItemProducto(config, apiFetch, recargar);
}

async function cargarCombos(apiFetch, path, idContenedor) {
  const el = document.getElementById(idContenedor);
  const fragment = document.createDocumentFragment();
  el.innerHTML = '<div class="cargando">Cargando combos</div>';

  try {
    const data = await apiFetch(path);
    if (!data || !data.length) {
      el.innerHTML = '<div class="vacio vacio-compacto">Sin combos</div>';
      return;
    }

    el.innerHTML = '';
    data.forEach(combo => {
      fragment.appendChild(crearTarjetaCombo(combo, apiFetch, () => cargarCombos(apiFetch, path, idContenedor)));
    });

    el.appendChild(fragment);
  } catch(e) {
    el.innerHTML = '<div class="vacio vacio-compacto">Error al cargar</div>';
  }
}

function crearTarjetaCombo(combo, apiFetch, recargar) {
  const tarjetaCombo = document.createElement('div');
  tarjetaCombo.className = 'tarjeta tarjeta-combo';

  const imagen = document.createElement('img');
  imagen.className = 'imagen-combo';
  imagen.src = obtenerImagenCombo(combo);
  imagen.alt = combo.nombre || combo.name || combo.title || 'Combo';
  imagen.addEventListener('error', () => {
    imagen.replaceWith(crearMarcadorImagen());
  });

  const cuerpo = document.createElement('div');
  cuerpo.className = 'contenido-combo';

  const encabezado = document.createElement('div');
  encabezado.className = 'encabezado-combo';

  const nombreCombo = document.createElement('p');
  nombreCombo.className = 'nombre-combo';
  nombreCombo.textContent = combo.nombre || combo.name || combo.title || '';

  const precioCombo = document.createElement('p');
  precioCombo.className = 'precio-combo';
  precioCombo.textContent = combo.precio ? `$${Number(combo.precio).toFixed(2)}` : '';

  encabezado.appendChild(nombreCombo);
  encabezado.appendChild(precioCombo);

  const elementosCombo = document.createElement('ul');
  elementosCombo.className = 'detalles-combo';
  Object.entries(combo.detalles || {}).forEach(([key, value]) => {
    const li = document.createElement('li');
    li.textContent = `${key}: ${value}`;
    elementosCombo.appendChild(li);
  });

  const acciones = document.createElement('div');
  acciones.className = 'acciones-tarjeta acciones-combo';

  const botonModificar = document.createElement('button');
  botonModificar.id = 'modificarCombo';
  botonModificar.className = 'boton boton-modificar';
  botonModificar.type = 'button';
  botonModificar.textContent = 'Modificar';
  botonModificar.dataset.id = combo.id;
  botonModificar.dataset.comboId = combo.id;
  botonModificar.addEventListener('click', () => mostrarModalCombo(combo, apiFetch, recargar));

  const botonEliminar = document.createElement('button');
  botonEliminar.id = 'eliminarCombo';
  botonEliminar.className = 'boton boton-eliminar';
  botonEliminar.type = 'button';
  botonEliminar.textContent = 'Eliminar';
  botonEliminar.dataset.id = combo.id;
  botonEliminar.dataset.comboId = combo.id;
  botonEliminar.addEventListener('click', () => eliminarCombo(combo.id, apiFetch, recargar, botonEliminar));

  acciones.appendChild(botonModificar);
  acciones.appendChild(botonEliminar);

  cuerpo.appendChild(encabezado);
  cuerpo.appendChild(elementosCombo);
  cuerpo.appendChild(acciones);

  tarjetaCombo.appendChild(imagen);
  tarjetaCombo.appendChild(cuerpo);

  return tarjetaCombo;
}

function obtenerImagenCombo(combo) {
  return combo.img || combo.imagen || combo.imagen_url || combo.image || combo.image_url || '';
}

function crearMarcadorImagen() {
  const marcador = document.createElement('div');
  marcador.className = 'marcador-imagen marcador-imagen-combo';
  marcador.textContent = 'sin imagen';
  return marcador;
}

async function eliminarCombo(id, apiFetch, recargar, boton) {
  if (!confirm('Seguro que quieres eliminar este combo?')) return;

  boton.disabled = true;
  boton.textContent = 'Eliminando...';

  try {
    await apiFetch(`/api/combos-comida/${encodeURIComponent(id)}`, { method: 'DELETE' });
    mostrarAviso('Combo eliminado', 'exito');
    recargar();
  } catch (e) {
    mostrarAviso('Error al eliminar: ' + e.message, 'error');
    boton.disabled = false;
    boton.textContent = 'Eliminar';
  }
}

function mostrarModalCombo(combo, apiFetch, recargar) {
  const modal = obtenerModalCombo();
  const form = modal.querySelector('#formularioModificarCombo');
  const detalles = combo.detalles || {};
  const imagenActual = obtenerImagenCombo(combo);

  form.dataset.id = combo.id;
  form.dataset.imagenActual = imagenActual;
  form.combo_id.value = combo.id || '';
  form.nombre.value = combo.nombre || '';
  form.precio.value = combo.precio || '';
  form.disponible.checked = combo.disponible !== false;
  form.imagen.value = '';
  modal.querySelector('#tituloModalCombo').textContent = 'Modificar combo';
  modal.querySelector('[data-id-combo]').textContent = combo.id || '-';

  const vistaImg = document.getElementById('vista-imagen-modal-combo');
  if (vistaImg) {
    vistaImg.innerHTML = imagenActual
      ? `<img src="${imagenActual}" alt="Imagen actual" style="width:100%;height:100%;object-fit:cover;display:block;" onerror="this.parentElement.innerHTML='<div class=&quot;marcador-imagen&quot;>sin imagen</div>'">`
      : `<div class="marcador-imagen">sin imagen</div>`;
  }

  const listaDetalles = modal.querySelector('[data-detalles-combo]');
  listaDetalles.innerHTML = '';
  Object.entries(detalles).forEach(([key, value]) => {
    listaDetalles.appendChild(crearFilaDetalle(key, value));
  });

  if (!Object.keys(detalles).length) {
    listaDetalles.appendChild(crearFilaDetalle('', ''));
  }

  modal.classList.add('visible');
  document.body.classList.add('modal-abierto');

  form.onsubmit = evento => guardarCombo(evento, apiFetch, recargar);
}

function mostrarModalCrearCombo(apiFetch, recargar) {
  const modal = obtenerModalCombo();
  const form = modal.querySelector('#formularioModificarCombo');

  form.dataset.id = '';
  form.dataset.imagenActual = '';
  form.combo_id.value = 'nuevo';
  form.nombre.value = '';
  form.precio.value = '';
  form.disponible.checked = true;
  form.imagen.value = '';
  modal.querySelector('#tituloModalCombo').textContent = 'Añadir combo';
  modal.querySelector('[data-id-combo]').textContent = 'nuevo';

  const vistaImg = document.getElementById('vista-imagen-modal-combo');
  if (vistaImg) vistaImg.innerHTML = `<div class="marcador-imagen">sin imagen</div>`;

  const listaDetalles = modal.querySelector('[data-detalles-combo]');
  listaDetalles.innerHTML = '';
  listaDetalles.appendChild(crearFilaDetalle('', ''));

  modal.classList.add('visible');
  document.body.classList.add('modal-abierto');

  form.onsubmit = evento => guardarNuevoCombo(evento, apiFetch, recargar);
}

function obtenerModalCombo() {
  let modal = document.getElementById('modalModificarCombo');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'modalModificarCombo';
  modal.className = 'modal-combo';
  modal.innerHTML = `
    <div class="panel-modal-combo" role="dialog" aria-modal="true" aria-labelledby="tituloModalCombo">
      <div class="encabezado-modal-combo">
        <div>
          <p class="etiqueta-modal-combo">Combo <span data-id-combo></span></p>
          <h2 id="tituloModalCombo">Modificar combo</h2>
        </div>
        <button type="button" class="boton-cerrar-modal" data-cerrar-modal aria-label="Cerrar">x</button>
      </div>
      <form id="formularioModificarCombo" class="formulario-combo">
        <div class="vista-imagen-combo" id="vista-imagen-modal-combo">
          <div class="marcador-imagen">sin imagen</div>
        </div>
        <label>
          ID
          <input class="entrada-configuracion" name="combo_id" type="text" readonly>
        </label>
        <label>
          Nombre
          <input class="entrada-configuracion" name="nombre" type="text" required>
        </label>
        <label>
          Precio
          <input class="entrada-configuracion" name="precio" type="number" min="0" step="0.01" required>
        </label>
        <label class="control-check-combo">
          <input name="disponible" type="checkbox">
          Disponible
        </label>
        <label>
          Imagen nueva
          <input class="entrada-configuracion" name="imagen" type="file" accept="image/*">
        </label>
        <div>
          <div class="fila-titulo-detalles">
            <span>Detalles</span>
            <button type="button" class="boton boton-secundario" data-agregar-detalle>Agregar item</button>
          </div>
          <div class="detalles-form-combo" data-detalles-combo></div>
        </div>
        <div class="acciones-modal-combo">
          <button type="button" class="boton boton-rechazar" data-cerrar-modal>Cancelar</button>
          <button type="submit" class="boton boton-aprobar">Guardar cambios</button>
        </div>
      </form>
    </div>`;

  modal.addEventListener('click', evento => {
    if (evento.target === modal || evento.target.closest('[data-cerrar-modal]')) {
      cerrarModalCombo();
    }

    if (evento.target.closest('[data-agregar-detalle]')) {
      modal.querySelector('[data-detalles-combo]').appendChild(crearFilaDetalle('', ''));
    }

    const botonQuitar = evento.target.closest('[data-quitar-detalle]');
    if (botonQuitar) botonQuitar.closest('.fila-detalle-combo').remove();
  });

  document.body.appendChild(modal);
  return modal;
}

function crearFilaDetalle(nombre = '', valor = '') {
  const fila = document.createElement('div');
  fila.className = 'fila-detalle-combo';
  fila.innerHTML = `
    <input class="entrada-configuracion" name="detalle_nombre" type="text" placeholder="Item" value="">
    <input class="entrada-configuracion" name="detalle_valor" type="text" placeholder="Cantidad" value="">
    <button type="button" class="boton-quitar-detalle" data-quitar-detalle aria-label="Quitar">x</button>`;

  fila.querySelector('[name="detalle_nombre"]').value = nombre;
  fila.querySelector('[name="detalle_valor"]').value = valor;
  return fila;
}

async function guardarCombo(evento, apiFetch, recargar) {
  evento.preventDefault();

  const form = evento.currentTarget;
  const boton = form.querySelector('[type="submit"]');
  const detalles = {};

  form.querySelectorAll('.fila-detalle-combo').forEach(fila => {
    const nombre = fila.querySelector('[name="detalle_nombre"]').value.trim();
    const valor = fila.querySelector('[name="detalle_valor"]').value.trim();
    if (nombre) detalles[nombre] = valor;
  });

  const datos = new FormData();
  datos.append('nombre', form.nombre.value.trim());
  datos.append('precio', form.precio.value);
  datos.append('disponible', form.disponible.checked ? 'true' : 'false');
  datos.append('detalles', JSON.stringify(detalles));
  datos.append('imagen_actual', form.dataset.imagenActual || '');
  if (form.imagen.files[0]) datos.append('imagen', form.imagen.files[0]);

  boton.disabled = true;
  boton.textContent = 'Guardando...';

  try {
    await apiFetch(`/api/combos-comida/${encodeURIComponent(form.dataset.id)}`, {
      method: 'PUT',
      body: datos
    });
    mostrarAviso('Combo actualizado', 'exito');
    cerrarModalCombo();
    recargar();
  } catch (e) {
    mostrarAviso('Error al actualizar: ' + e.message, 'error');
  } finally {
    boton.disabled = false;
    boton.textContent = 'Guardar cambios';
  }
}

async function guardarNuevoCombo(evento, apiFetch, recargar) {
  evento.preventDefault();

  const form = evento.currentTarget;
  const boton = form.querySelector('[type="submit"]');
  const detalles = {};

  form.querySelectorAll('.fila-detalle-combo').forEach(fila => {
    const nombre = fila.querySelector('[name="detalle_nombre"]').value.trim();
    const valor = fila.querySelector('[name="detalle_valor"]').value.trim();
    if (nombre) detalles[nombre] = valor;
  });

  const datos = new FormData();
  datos.append('nombre', form.nombre.value.trim());
  datos.append('precio', form.precio.value);
  datos.append('disponible', form.disponible.checked ? 'true' : 'false');
  datos.append('detalles', JSON.stringify(detalles));
  if (form.imagen.files[0]) datos.append('imagen', form.imagen.files[0]);

  boton.disabled = true;
  boton.textContent = 'Creando...';

  try {
    await apiFetch('/api/combos-comida', {
      method: 'POST',
      body: datos
    });
    mostrarAviso('Combo añadido', 'exito');
    cerrarModalCombo();
    recargar();
  } catch (e) {
    mostrarAviso('Error al añadir: ' + e.message, 'error');
  } finally {
    boton.disabled = false;
    boton.textContent = 'Guardar cambios';
  }
}

function cerrarModalCombo() {
  const modal = document.getElementById('modalModificarCombo');
  if (!modal) return;
  modal.classList.remove('visible');
  document.body.classList.remove('modal-abierto');
}

function mostrarAviso(mensaje, tipo = '') {
  const aviso = document.getElementById('aviso');
  if (!aviso) {
    alert(mensaje);
    return;
  }

  aviso.textContent = mensaje;
  aviso.className = `aviso mostrar ${tipo}`.trim();
  setTimeout(() => aviso.className = 'aviso', 2500);
}

async function cargarListaProductos(apiFetch, path, idContenedor, onCategoriasProductos) {
  const el = document.getElementById(idContenedor);
  const config = obtenerConfigProducto(path, idContenedor);
  el.innerHTML = '<div class="cargando">Cargando...</div>';

  try {
    const data = await apiFetch(path);
    const esProductos = path.includes('/api/productos');
    if (esProductos && typeof onCategoriasProductos === 'function') {
      onCategoriasProductos(data || []);
    }
    if (!data || !data.length) {
      el.innerHTML = `<div class="vacio vacio-compacto">${config.textoVacio}</div>`;
      return;
    }

    if (esProductos) {
      configurarFiltroCategorias(data, el, config, apiFetch, path, idContenedor, onCategoriasProductos);
      return;
    }

    renderizarListaProductos(data, el, config, apiFetch, () => cargarListaProductos(apiFetch, path, idContenedor, onCategoriasProductos));
  } catch(e) {
    el.innerHTML = '<div class="vacio vacio-compacto">Error al cargar</div>';
  }
}

function renderizarListaProductos(items, el, config, apiFetch, recargar) {
  const fragment = document.createDocumentFragment();
  el.innerHTML = '';
  items.forEach(item => {
    fragment.appendChild(crearTarjetaProducto(item, config, apiFetch, recargar));
  });
  el.appendChild(fragment);
}

function configurarFiltroCategorias(data, el, config, apiFetch, path, idContenedor, onCategoriasProductos) {
  const parent = el.parentElement;
  if (!parent) {
    renderizarListaProductos(data, el, config, apiFetch, () => cargarListaProductos(apiFetch, path, idContenedor, onCategoriasProductos));
    return;
  }

  let filtro = parent.querySelector('[data-filtro-categoria-productos]');
  if (!filtro) {
    filtro = document.createElement('div');
    filtro.className = 'barra-filtro-categorias';
    filtro.dataset.filtroCategoriaProductos = 'true';
    filtro.innerHTML = `
      <label class="filtro-categoria-productos">
        Categoria
        <select class="entrada-configuracion" id="filtro-categoria-productos"></select>
      </label>`;
    parent.insertBefore(filtro, el);
  }

  const select = filtro.querySelector('#filtro-categoria-productos');
  const categorias = obtenerCategoriasDesdeProductos(data);
  const seleccionGuardada = localStorage.getItem(CATEGORY_FILTER_KEY) || '';
  const seleccion = seleccionGuardada && categorias.includes(seleccionGuardada) ? seleccionGuardada : '';

  select.innerHTML = '';
  select.appendChild(new Option('Todas las categorias', ''));
  categorias.forEach(categoria => select.appendChild(new Option(categoria, categoria)));
  select.value = seleccion;

  const recargar = () => cargarListaProductos(apiFetch, path, idContenedor, onCategoriasProductos);
  const renderFiltrado = () => {
    const categoria = select.value;
    const items = categoria
      ? data.filter(item => String(item.categoria || '').trim() === categoria)
      : data;

    if (!items.length) {
      el.innerHTML = '<div class="vacio vacio-compacto">Sin productos en esta categoria</div>';
      return;
    }

    renderizarListaProductos(items, el, config, apiFetch, recargar);
  };

  select.onchange = () => {
    localStorage.setItem(CATEGORY_FILTER_KEY, select.value);
    renderFiltrado();
  };

  renderFiltrado();
}

function obtenerCategoriasDesdeProductos(data) {
  return [...new Set(
    data
      .map(item => String(item.categoria || '').trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'es'));
}

function obtenerConfigProducto(path, idContenedor) {
  const esElectro = path.includes('electrodomesticos') || idContenedor === 'lista-electro';

  if (esElectro) {
    return {
      tipo: 'electrodomestico',
      etiqueta: 'Electrodomestico',
      endpoint: '/api/electrodomesticos',
      textoVacio: 'Sin electrodomesticos',
      botonModificarId: 'modificarElectrodomestico',
      botonEliminarId: 'eliminarElectrodomestico',
      titulo: item => item.item || item.tipo || `Electrodomestico ${item.id}`,
      campos: [
        { nombre: 'item', etiqueta: 'Item', tipo: 'text', requerido: true },
        { nombre: 'tipo', etiqueta: 'Tipo', tipo: 'text' },
        { nombre: 'precio', etiqueta: 'Precio', tipo: 'text' },
        { nombre: 'disponible', etiqueta: 'Disponible', tipo: 'checkbox' }
      ],
      resumen: [
        { nombre: 'tipo', etiqueta: 'Tipo' },
        { nombre: 'disponible', etiqueta: 'Disponible', formato: valor => valor ? 'Si' : 'No' }
      ]
    };
  }

  return {
    tipo: 'producto',
    etiqueta: 'Producto',
    endpoint: '/api/productos',
    textoVacio: 'Sin productos',
    botonModificarId: 'modificarProducto',
    botonEliminarId: 'eliminarProducto',
    titulo: item => item.nombre || `Producto ${item.id}`,
    campos: [
      { nombre: 'nombre', etiqueta: 'Nombre', tipo: 'text', requerido: true },
      { nombre: 'precio', etiqueta: 'Precio', tipo: 'number', step: '0.01' },
      { nombre: 'cantidad', etiqueta: 'Cantidad', tipo: 'number', step: '1' },
      { nombre: 'disponible', etiqueta: 'Disponible', tipo: 'checkbox' },
      { nombre: 'categoria', etiqueta: 'Categoria', tipo: 'category' },
      { nombre: 'detalles', etiqueta: 'Detalles', tipo: 'textarea' }
    ],
    resumen: [
      { nombre: 'cantidad', etiqueta: 'Cantidad' },
      { nombre: 'categoria', etiqueta: 'Categoria' },
      { nombre: 'detalles', etiqueta: 'Detalles' },
      { nombre: 'disponible', etiqueta: 'Disponible', formato: valor => valor ? 'Si' : 'No' }
    ]
  };
}

function crearTarjetaProducto(item, config, apiFetch, recargar) {
  const tarjeta = document.createElement('div');
  tarjeta.className = 'tarjeta tarjeta-producto tarjeta-producto-admin';

  const imagenUrl = obtenerImagenProducto(item);
  const imagen = document.createElement('img');
  imagen.className = 'imagen-producto-admin';
  imagen.src = imagenUrl;
  imagen.alt = config.titulo(item);
  imagen.addEventListener('error', () => {
    imagen.replaceWith(crearMarcadorImagenProducto());
  });

  const cuerpo = document.createElement('div');
  cuerpo.className = 'contenido-producto-admin';

  const encabezado = document.createElement('div');
  encabezado.className = 'encabezado-producto';

  const nombre = document.createElement('div');
  nombre.className = 'nombre-producto';
  nombre.textContent = config.titulo(item);

  const precio = document.createElement('div');
  precio.className = 'precio-producto';
  precio.textContent = formatearPrecioProducto(item.precio);

  encabezado.appendChild(nombre);
  if (item.precio !== null && item.precio !== undefined && item.precio !== '') {
    encabezado.appendChild(precio);
  }

  const resumen = document.createElement('ul');
  resumen.className = 'detalles-producto-admin';
  config.resumen.forEach(campo => {
    const valor = item[campo.nombre];
    if (valor === null || valor === undefined || valor === '') return;

    const li = document.createElement('li');
    const textoValor = campo.formato ? campo.formato(valor) : valor;
    li.textContent = `${campo.etiqueta}: ${textoValor}`;
    resumen.appendChild(li);
  });

  const acciones = document.createElement('div');
  acciones.className = 'acciones-tarjeta acciones-producto-admin';

  const botonModificar = document.createElement('button');
  botonModificar.id = config.botonModificarId;
  botonModificar.className = 'boton boton-modificar';
  botonModificar.type = 'button';
  botonModificar.textContent = 'Modificar';
  botonModificar.dataset.id = item.id;
  botonModificar.dataset[`${config.tipo}Id`] = item.id;
  botonModificar.addEventListener('click', () => mostrarModalProducto(item, config, apiFetch, recargar));

  const botonEliminar = document.createElement('button');
  botonEliminar.id = config.botonEliminarId;
  botonEliminar.className = 'boton boton-eliminar';
  botonEliminar.type = 'button';
  botonEliminar.textContent = 'Eliminar';
  botonEliminar.dataset.id = item.id;
  botonEliminar.dataset[`${config.tipo}Id`] = item.id;
  botonEliminar.addEventListener('click', () => eliminarItemProducto(item.id, config, apiFetch, recargar, botonEliminar));

  acciones.appendChild(botonModificar);
  acciones.appendChild(botonEliminar);

  cuerpo.appendChild(encabezado);
  if (resumen.children.length) cuerpo.appendChild(resumen);
  cuerpo.appendChild(acciones);

  tarjeta.appendChild(imagenUrl ? imagen : crearMarcadorImagenProducto());
  tarjeta.appendChild(cuerpo);

  return tarjeta;
}

function obtenerImagenProducto(item) {
  return item.img || item.imagen || item.imagen_url || item.image || item.image_url || '';
}

function crearMarcadorImagenProducto() {
  const marcador = document.createElement('div');
  marcador.className = 'marcador-imagen marcador-imagen-producto';
  marcador.textContent = 'sin imagen';
  return marcador;
}

function formatearPrecioProducto(precio) {
  if (precio === null || precio === undefined || precio === '') return '';
  const numero = Number(precio);
  return Number.isFinite(numero) ? `$${numero.toFixed(2)}` : precio;
}

async function eliminarItemProducto(id, config, apiFetch, recargar, boton) {
  if (!confirm(`Seguro que quieres eliminar este ${config.etiqueta.toLowerCase()}?`)) return;

  boton.disabled = true;
  boton.textContent = 'Eliminando...';

  try {
    await apiFetch(`${config.endpoint}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    mostrarAviso(`${config.etiqueta} eliminado`, 'exito');
    recargar();
  } catch (e) {
    mostrarAviso('Error al eliminar: ' + e.message, 'error');
    boton.disabled = false;
    boton.textContent = 'Eliminar';
  }
}

function mostrarModalProducto(item, config, apiFetch, recargar) {
  const modal = obtenerModalProducto();
  const imagenActual = obtenerImagenProducto(item);

  modal.innerHTML = `
    <div class="panel-modal-combo" role="dialog" aria-modal="true" aria-labelledby="tituloModalProducto">
      <div class="encabezado-modal-combo">
        <div>
          <p class="etiqueta-modal-combo">${config.etiqueta} <span data-id-producto></span></p>
          <h2 id="tituloModalProducto">Modificar ${config.etiqueta.toLowerCase()}</h2>
        </div>
        <button type="button" class="boton-cerrar-modal" data-cerrar-modal aria-label="Cerrar">x</button>
      </div>
      <form id="formularioModificarProducto" class="formulario-combo">
        <div class="vista-imagen-combo">
          ${imagenActual
            ? `<img src="${imagenActual}" alt="Imagen actual" style="width:100%;height:100%;object-fit:cover;display:block;" onerror="this.parentElement.innerHTML='<div class=&quot;marcador-imagen&quot;>sin imagen</div>'">`
            : `<div class="marcador-imagen">sin imagen</div>`}
        </div>
        <label>
          ID
          <input class="entrada-configuracion" name="item_id" type="text" readonly>
        </label>
        <div data-campos-producto></div>
        <label>
          Imagen nueva
          <input class="entrada-configuracion" name="imagen" type="file" accept="image/*">
        </label>
        <div class="acciones-modal-combo">
          <button type="button" class="boton boton-rechazar" data-cerrar-modal>Cancelar</button>
          <button type="submit" class="boton boton-aprobar">Guardar cambios</button>
        </div>
      </form>
    </div>`;

  const form = modal.querySelector('#formularioModificarProducto');
  form.dataset.id = item.id;
  form.dataset.endpoint = config.endpoint;
  form.dataset.imagenActual = imagenActual;
  form.item_id.value = item.id || '';
  modal.querySelector('[data-id-producto]').textContent = item.id || '-';

  const contenedorCampos = modal.querySelector('[data-campos-producto]');
  config.campos.forEach(campo => {
    contenedorCampos.appendChild(crearCampoFormularioProducto(campo, item[campo.nombre]));
  });

  modal.classList.add('visible');
  document.body.classList.add('modal-abierto');

  form.onsubmit = evento => guardarItemProducto(evento, config, apiFetch, recargar);
}

function mostrarModalCrearItemProducto(config, apiFetch, recargar) {
  const modal = obtenerModalProducto();

  modal.innerHTML = `
    <div class="panel-modal-combo" role="dialog" aria-modal="true" aria-labelledby="tituloModalProducto">
      <div class="encabezado-modal-combo">
        <div>
          <p class="etiqueta-modal-combo">${config.etiqueta} <span data-id-producto>nuevo</span></p>
          <h2 id="tituloModalProducto">Añadir ${config.etiqueta.toLowerCase()}</h2>
        </div>
        <button type="button" class="boton-cerrar-modal" data-cerrar-modal aria-label="Cerrar">x</button>
      </div>
      <form id="formularioModificarProducto" class="formulario-combo">
        <div class="vista-imagen-combo">
          <div class="marcador-imagen">sin imagen</div>
        </div>
        <div data-campos-producto></div>
        <label>
          Imagen
          <input class="entrada-configuracion" name="imagen" type="file" accept="image/*">
        </label>
        <div class="acciones-modal-combo">
          <button type="button" class="boton boton-rechazar" data-cerrar-modal>Cancelar</button>
          <button type="submit" class="boton boton-aprobar">Crear</button>
        </div>
      </form>
    </div>`;

  const form = modal.querySelector('#formularioModificarProducto');
  form.dataset.endpoint = config.endpoint;

  const contenedorCampos = modal.querySelector('[data-campos-producto]');
  config.campos.forEach(campo => {
    const valorInicial = campo.tipo === 'checkbox' ? true : '';
    contenedorCampos.appendChild(crearCampoFormularioProducto(campo, valorInicial));
  });

  modal.classList.add('visible');
  document.body.classList.add('modal-abierto');

  form.onsubmit = evento => guardarNuevoItemProducto(evento, config, apiFetch, recargar);
}

function obtenerModalProducto() {
  let modal = document.getElementById('modalModificarProducto');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'modalModificarProducto';
  modal.className = 'modal-combo';
  modal.addEventListener('click', evento => {
    if (evento.target === modal || evento.target.closest('[data-cerrar-modal]')) {
      cerrarModalProducto();
    }
  });

  document.body.appendChild(modal);
  return modal;
}

function crearCampoFormularioProducto(campo, valor) {
  const label = document.createElement('label');
  label.textContent = campo.etiqueta;

  if (campo.tipo === 'checkbox') {
    label.className = 'control-check-combo';
    const input = document.createElement('input');
    input.name = campo.nombre;
    input.type = 'checkbox';
    input.checked = valor !== false;
    label.prepend(input);
    return label;
  }

  if (campo.tipo === 'category') {
    label.appendChild(crearSelectorCategoria(valor));
    return label;
  }

  const input = campo.tipo === 'textarea'
    ? document.createElement('textarea')
    : document.createElement('input');

  input.className = 'entrada-configuracion';
  input.name = campo.nombre;
  input.value = valor ?? '';

  if (campo.tipo !== 'textarea') {
    input.type = campo.tipo;
    if (campo.step) input.step = campo.step;
  } else {
    input.rows = 4;
  }

  if (campo.requerido) input.required = true;
  label.appendChild(input);
  return label;
}

function crearSelectorCategoria(valor) {
  const wrapper = document.createElement('div');
  wrapper.className = 'campo-categoria';

  const select = document.createElement('select');
  select.className = 'entrada-configuracion';
  select.name = 'categoria';

  const categorias = obtenerCategoriasGuardadas();
  const valorActual = String(valor ?? '').trim();
  const opciones = valorActual && !categorias.includes(valorActual)
    ? [valorActual, ...categorias]
    : categorias;

  select.appendChild(new Option('Selecciona una categoria', ''));
  opciones.forEach(categoria => select.appendChild(new Option(categoria, categoria)));
  select.appendChild(new Option('+ Añadir nueva categoria', NEW_CATEGORY_VALUE));
  select.value = valorActual || '';

  const inputNuevo = document.createElement('input');
  inputNuevo.className = 'entrada-configuracion entrada-categoria-nueva';
  inputNuevo.name = 'categoria_nueva';
  inputNuevo.type = 'text';
  inputNuevo.placeholder = 'Nueva categoria';
  inputNuevo.hidden = select.value !== NEW_CATEGORY_VALUE;

  select.addEventListener('change', () => {
    const nueva = select.value === NEW_CATEGORY_VALUE;
    inputNuevo.hidden = !nueva;
    inputNuevo.required = nueva;
    if (nueva) inputNuevo.focus();
  });

  wrapper.appendChild(select);
  wrapper.appendChild(inputNuevo);
  return wrapper;
}

function obtenerCategoriasGuardadas() {
  try {
    return (JSON.parse(localStorage.getItem(CATEGORIES_KEY)) || [])
      .map(categoria => String(categoria || '').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function guardarItemProducto(evento, config, apiFetch, recargar) {
  evento.preventDefault();

  const form = evento.currentTarget;
  const boton = form.querySelector('[type="submit"]');
  const datos = new FormData();

  config.campos.forEach(campo => {
    const valor = obtenerValorCampo(form, campo);
    if (valor === null) return;
    datos.append(campo.nombre, valor);
  });

  datos.append('imagen_actual', form.dataset.imagenActual || '');
  if (form.imagen.files[0]) datos.append('imagen', form.imagen.files[0]);

  boton.disabled = true;
  boton.textContent = 'Guardando...';

  try {
    await apiFetch(`${form.dataset.endpoint}/${encodeURIComponent(form.dataset.id)}`, {
      method: 'PUT',
      body: datos
    });
    mostrarAviso(`${config.etiqueta} actualizado`, 'exito');
    cerrarModalProducto();
    recargar();
  } catch (e) {
    mostrarAviso('Error al actualizar: ' + e.message, 'error');
  } finally {
    boton.disabled = false;
    boton.textContent = 'Guardar cambios';
  }
}

async function guardarNuevoItemProducto(evento, config, apiFetch, recargar) {
  evento.preventDefault();

  const form = evento.currentTarget;
  const boton = form.querySelector('[type="submit"]');
  const datos = new FormData();

  config.campos.forEach(campo => {
    const valor = obtenerValorCampo(form, campo);
    if (valor === null) return;
    datos.append(campo.nombre, valor);
  });

  if (form.imagen.files[0]) datos.append('imagen', form.imagen.files[0]);

  boton.disabled = true;
  boton.textContent = 'Creando...';

  try {
    await apiFetch(config.endpoint, {
      method: 'POST',
      body: datos
    });
    mostrarAviso(`${config.etiqueta} añadido`, 'exito');
    cerrarModalProducto();
    recargar();
  } catch (e) {
    mostrarAviso('Error al añadir: ' + e.message, 'error');
  } finally {
    boton.disabled = false;
    boton.textContent = 'Crear';
  }
}

function cerrarModalProducto() {
  const modal = document.getElementById('modalModificarProducto');
  if (!modal) return;
  modal.classList.remove('visible');
  document.body.classList.remove('modal-abierto');
}

function obtenerValorCampo(form, campo) {
  const control = form.querySelector(`[name="${campo.nombre}"]`);
  if (!control) return null;

  if (campo.tipo === 'checkbox') return control.checked ? 'true' : 'false';

  if (campo.tipo === 'category') {
    const valor = control.value === NEW_CATEGORY_VALUE
      ? form.querySelector('[name="categoria_nueva"]')?.value?.trim()
      : control.value.trim();
    return valor || '';
  }

  return control.value.trim();
}
