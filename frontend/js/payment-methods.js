import { getInfo } from "./api.js?v28";

let methodosCache = null;
let ultimaCarga = null;
let tropipayEnabled = false;

export const PAYMENT_FLOW_PROOF_UPLOAD = "proof_upload";
export const PAYMENT_FLOW_ASSISTED = "assisted";
export const PAYMENT_FLOW_TROPIPAY = "tropipay";

const ASSISTED_PAYMENT_METHODS = [
  {
    id: "assisted-mexico",
    method_name: "Transferencia desde México",
    account_number: "",
    instructions: "Nuestro equipo te contactara por WhatsApp para darte los datos de transferencia en México. Despues de transferir, envia el comprobante por WhatsApp para validacion manual.",
    image_url: "./images/payment-mexico-icon.webp",
    is_active: true,
    order_index: 30,
    payment_flow: PAYMENT_FLOW_ASSISTED,
    confirmation_note: "Validacion manual por un intermediario del equipo."
  },
  {
    id: "assisted-brazil",
    method_name: "Transferencia desde Brasil",
    account_number: "",
    instructions: "Nuestro equipo te contactara por WhatsApp para darte los datos de transferencia en Brasil. Despues de transferir, envia el comprobante por WhatsApp para validacion manual.",
    image_url: "./images/payment-brazil-icon.webp",
    is_active: true,
    order_index: 31,
    payment_flow: PAYMENT_FLOW_ASSISTED,
    confirmation_note: "Validacion manual por un intermediario del equipo."
  },
  {
    id: "assisted-iban-eu",
    method_name: "Transferencia IBAN Europa",
    account_number: "",
    instructions: "Nuestro equipo te contactara por WhatsApp para darte los datos IBAN. En pagos por IBAN Europa usamos la misma cifra del pedido, pero en euros. Por ejemplo: si el total es $70 USD, debes enviar 70 EUR. Esa diferencia nos ayuda a cubrir las comisiones de procesamiento e intermediacion de este metodo. Las transferencias europeas pueden demorar mas en confirmarse segun el banco emisor.",
    image_url: "./images/payment-iban-eu-icon.webp",
    is_active: true,
    order_index: 32,
    payment_flow: PAYMENT_FLOW_ASSISTED,
    confirmation_note: "La confirmacion puede tardar mas que otros metodos."
  }
];

// TropiPay no depende de la tabla payment_methods: se ofrece cuando el backend tiene credenciales
const TROPIPAY_METHOD = {
  id: "tropipay",
  method_name: "TropiPay",
  account_number: "",
  instructions: "Paga con tarjeta de crédito o débito en la pasarela segura de TropiPay. Al confirmar te llevamos a TropiPay y, cuando el pago se aprueba, tu pedido pasa a preparación automáticamente.",
  image_url: "",
  is_active: true,
  order_index: 0,
  payment_flow: PAYMENT_FLOW_TROPIPAY
};

function normalizeMethod(method) {
  return {
    ...method,
    payment_flow: method.payment_flow || (String(method.method_name || "").toLowerCase().includes("tropipay") ? PAYMENT_FLOW_TROPIPAY : PAYMENT_FLOW_PROOF_UPLOAD)
  };
}

function mergeAssistedMethods(methods) {
  const existingNames = new Set(methods.map(m => String(m.method_name || "").toLowerCase()));
  const assisted = ASSISTED_PAYMENT_METHODS.filter(m => !existingNames.has(m.method_name.toLowerCase()));
  let merged = [...methods.map(normalizeMethod), ...assisted];
  // Sin credenciales en el backend, TropiPay fallaría al pagar: no se ofrece
  merged = merged.filter(m => m.payment_flow !== PAYMENT_FLOW_TROPIPAY || tropipayEnabled);
  if (tropipayEnabled && !merged.some(m => m.payment_flow === PAYMENT_FLOW_TROPIPAY)) merged.push(TROPIPAY_METHOD);
  return merged.sort((a, b) => (a.order_index ?? 999) - (b.order_index ?? 999));
}

export async function cargarMetodosPago(forzar = false) {
  const ahora = Date.now();
  if (!forzar && methodosCache && ultimaCarga && ahora - ultimaCarga < 60000) {
    return methodosCache;
  }

  try {
    const info = await getInfo();
    tropipayEnabled = info?.tropipay_enabled === true;
    const metodos = (info.payment_methods || [])
      .filter(m => m.is_active !== false)
      .sort((a, b) => (a.order_index || 999) - (b.order_index || 999));

    methodosCache = mergeAssistedMethods(metodos);
    ultimaCarga = ahora;
    return methodosCache;
  } catch (err) {
    console.error("Error cargando métodos de pago:", err);
    return methodosCache || mergeAssistedMethods([]);
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
        ${metodo.payment_flow === PAYMENT_FLOW_ASSISTED ? `<small class="method-flow-label">Contacto por WhatsApp</small>` : ''}
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
