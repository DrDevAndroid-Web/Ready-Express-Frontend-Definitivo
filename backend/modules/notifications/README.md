# Sistema de Notificaciones SSE

Este módulo proporciona un sistema de **Server-Sent Events (SSE)** para notificaciones en tiempo real al dashboard de administración (APK React Native).

## Endpoints

### 1. **Subscribe to Notifications (SSE)**
```
GET /api/notifications/subscribe
```

**Descripción:** Abre una conexión persistente SSE para recibir notificaciones en tiempo real.

**Respuesta (streaming):**
```json
{
  "type": "connection_established",
  "clientId": "client-1-1234567890",
  "timestamp": "2026-01-15T10:30:00.000Z",
  "message": "Conectado al sistema de notificaciones"
}

{
  "type": "payment_received",
  "timestamp": "2026-01-15T10:31:00.000Z",
  "data": {
    "paymentId": "pay-123",
    "orderId": "order-456",
    "method": "WellsFargoZelle",
    "amount": 25.50,
    "imageUrl": "https://...",
    "createdAt": "2026-01-15T10:31:00.000Z",
    "message": "Nuevo comprobante de pago recibido"
  }
}
```

**Tipos de notificaciones:**
- `connection_established` - Conexión exitosa
- `payment_received` - Nuevo comprobante de pago
- `payment_approved` - Pago aprobado
- `payment_rejected` - Pago rechazado
- `order_created` - Nueva orden creada
- `order_delivered` - Orden entregada

### 2. **Connection Stats**
```
GET /api/notifications/stats
```

**Respuesta:**
```json
{
  "connectedClients": 3,
  "timestamp": "2026-01-15T10:30:00.000Z"
}
```

## Implementación en React Native

### Instalación (expo/react-native)
```bash
npm install react-native-event-source
# o
yarn add react-native-event-source
```

### Ejemplo Básico

```javascript
import { EventSource } from 'react-native-event-source';

export function useSSENotifications() {
  const [notifications, setNotifications] = useState([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const eventSource = new EventSource(
      'https://readyexpressnowbackend.versabold.com/api/notifications/subscribe'
    );

    eventSource.onopen = () => {
      console.log('✅ Conectado al servidor de notificaciones');
      setIsConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const notification = JSON.parse(event.data);
        console.log('📬 Notificación recibida:', notification);
        setNotifications(prev => [notification, ...prev]);
      } catch (err) {
        console.error('Error parseando notificación:', err);
      }
    };

    eventSource.onerror = (error) => {
      console.error('❌ Error SSE:', error);
      setIsConnected(false);
    };

    return () => {
      eventSource.close();
    };
  }, []);

  return { notifications, isConnected };
}
```

### Componente de Dashboard

```javascript
import { View, ScrollView, Text, Image } from 'react-native';

export function AdminNotificationsDashboard() {
  const { notifications, isConnected } = useSSENotifications();

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 12 }}>
        📊 Panel de Notificaciones
      </Text>

      <Text style={{ marginBottom: 16, color: isConnected ? 'green' : 'red' }}>
        {isConnected ? '🟢 Conectado' : '🔴 Desconectado'}
      </Text>

      <ScrollView>
        {notifications.map((notif, idx) => (
          <View 
            key={idx}
            style={{
              backgroundColor: '#f5f5f5',
              padding: 12,
              marginBottom: 10,
              borderRadius: 8,
              borderLeftWidth: 4,
              borderLeftColor: getColorForType(notif.type)
            }}
          >
            <Text style={{ fontWeight: 'bold' }}>
              {notif.data?.message || notif.type}
            </Text>
            <Text style={{ color: '#666', marginTop: 4, fontSize: 12 }}>
              {notif.timestamp}
            </Text>

            {notif.type === 'payment_received' && (
              <View style={{ marginTop: 8 }}>
                <Text>💰 ${notif.data.amount}</Text>
                <Text>📱 {notif.data.method}</Text>
                {notif.data.imageUrl && (
                  <Image
                    source={{ uri: notif.data.imageUrl }}
                    style={{ width: 100, height: 100, marginTop: 8, borderRadius: 4 }}
                  />
                )}
              </View>
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function getColorForType(type) {
  const colors = {
    payment_received: '#FF9800',
    payment_approved: '#4CAF50',
    payment_rejected: '#F44336',
    order_created: '#2196F3',
    order_delivered: '#4CAF50'
  };
  return colors[type] || '#999';
}
```

## Flujo Completo

### 1. Cliente (APK Admin) se conecta:
```
GET /api/notifications/subscribe
← Connection established
```

### 2. Cliente envía comprobante:
```
POST /api/payments/upload → Comprime imagen → Sube a Storage
→ SSE: payment_received
```

### 3. Admin revisa y aprueba:
```
PATCH /api/payments/:id/verify?action=approve
→ Envía a impresora
→ SSE: payment_approved
```

### 4. Dashboard recibe y actualiza en tiempo real

## Ventajas sobre CallMeBot

✅ **En tiempo real** - Notificaciones instantáneas
✅ **Sin costo** - No requiere API de terceros
✅ **Bidireccional** - Dashboard recibe todas las eventos
✅ **Escalable** - Múltiples admin conectados simultáneamente
✅ **Confiable** - Heartbeat cada 30s mantiene conexión viva
✅ **Flexible** - Diferentes tipos de eventos

## Prueba desde Terminal (curl)

```bash
curl -X GET "https://readyexpressnowbackend.versabold.com/api/notifications/subscribe"
```

La conexión se mantendrá abierta esperando eventos.

## Variables de Entorno Requeridas

Ya no necesitas:
- ~~`WHATSAPP_PHONE`~~
- ~~`WHATSAPP_APIKEY`~~

El sistema de SSE no requiere configuración adicional.
