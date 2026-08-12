import { getInfo } from "./api.js?v10";

let methodosCache = null;
let ultimaCarga = null;

export async function cargarMetodosPago(forzar = false) {
  const ahora = Date.now();
  if (!forzar && methodosCache && ultimaCarga && ahora - ultimaCarga < 60000) {
    return methodosCache;
  }

  try {
    const info = await getInfo();
    const metodos = (info.payment_methods || [])
      .filter(m => m.is_active !== false)
      .sort((a, b) => (a.order_index || 999) - (b.order_index || 999));

    methodosCache = metodos;
    ultimaCarga = ahora;
    return metodos;
  } catch (err) {
    console.error("Error cargando métodos de pago:", err);
    return methodosCache || [];
  }
}

export function renderMetodosEnCheckout(contenedor, onSeleccionar) {
  if (!contenedor) return;

  const metodos = methodosCache || [];
  if (!metodos.length) {
    contenedor.innerHTML = '<div class="alerta">Sin métodos de pago disponibles</div>';
    return;
  }

  contenedor.innerHTML = metodos.map(metodo => `
    <div class="metodo-pago-option" data-method-id="${metodo.id}">
      <button type="button" class="btn-metodo-pago" onclick="window.selectarMetodoPago('${metodo.id}')">
        <div class="nombre-metodo">${metodo.method_name}</div>
        ${metodo.image_url ? `<img src="${metodo.image_url}" alt="${metodo.method_name}" class="img-metodo">` : ''}
      </button>
    </div>
  `).join('');

  window.selectarMetodoPago = function(id) {
    document.querySelectorAll('.metodo-pago-option').forEach(el => {
      el.classList.remove('selected');
    });
    const selected = document.querySelector(`[data-method-id="${id}"]`);
    if (selected) selected.classList.add('selected');

    const metodo = metodos.find(m => m.id === id);
    if (onSeleccionar && metodo) onSeleccionar(metodo);
  };
}

export function renderMetodosEnAyuda(contenedor) {
  if (!contenedor) return;

  const metodos = methodosCache || [];
  if (!metodos.length) {
    contenedor.innerHTML = '<div class="alerta">Sin métodos de pago disponibles</div>';
    return;
  }

  contenedor.innerHTML = metodos.map(metodo => `
    <div class="tarjeta-metodo-ayuda">
      <div class="encabezado-metodo-ayuda">
        <h3>${metodo.method_name}</h3>
      </div>
      ${metodo.image_url ? `<img src="${metodo.image_url}" alt="${metodo.method_name}" class="img-metodo-ayuda">` : ''}
      <div class="contenido-metodo-ayuda">
        ${metodo.account_number ? `<div class="dato-metodo"><strong>Cuenta:</strong> ${metodo.account_number}</div>` : ''}
        <div class="instrucciones-metodo"><strong>Instrucciones:</strong></div>
        <p>${metodo.instructions}</p>
      </div>
    </div>
  `).join('');
}

export function obtenerMetodoPago(id) {
  return (methodosCache || []).find(m => m.id === id);
}

export async function inicializarMetodosPago() {
  return await cargarMetodosPago();
}
