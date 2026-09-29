# Stride · entrenamiento híbrido

Aplicación personal local para planificar carrera y fuerza, registrar actividades FIT/GPX y conservar el historial de cada versión del plan.

## Requisitos

- Node.js 22.12 o posterior (la base SQLite usa `node:sqlite`).
- pnpm 9 o posterior.

## Ejecutar en desarrollo

```powershell
pnpm install
pnpm dev
```

Abre la dirección local que muestre Vite, normalmente `http://localhost:5173`. Para entrar desde un teléfono conectado a la misma Wi-Fi, abre en el teléfono la dirección de red local que muestre la terminal. Windows puede pedir permiso para permitir conexiones privadas; habilita la red privada para que el teléfono alcance el ordenador.

El acceso local usa HTTP y no configura TLS. Úsalo solo en una red privada de confianza y no publiques ni redirijas el puerto a Internet.

En el primer acceso, crea una contraseña de al menos 12 caracteres. La contraseña se almacena como hash scrypt en la base local. Las sesiones se invalidan al reiniciar el servidor.

## Ejecutar una compilación local

```powershell
pnpm install
pnpm build
pnpm start
```

La aplicación queda disponible en `http://localhost:4178` y en la dirección local del ordenador, puerto `4178`.

## Datos y copias de seguridad

La base de datos SQLite se crea en `data/stride.sqlite`. Puedes elegir otra carpeta con `DATA_DIR`; el puerto del servidor se puede cambiar con `PORT`. La pantalla **Ajustes y datos** permite exportar o restaurar un archivo JSON. Restaurar reemplaza el perfil, el objetivo, los planes y las actividades actuales, pero conserva la contraseña de acceso.

Los archivos importados se procesan localmente. GPX aporta ruta, distancia calculada y, cuando existe, duración; FIT puede aportar distancia, duración y frecuencia cardiaca. Los duplicados se detectan por el hash del archivo.

## Alcance

La planificación inicial cubre metas de 5K, 10K y media maratón, con progresión por fases y semanas de descarga. La reevaluación local propone ajustes según RPE, molestias y sesiones omitidas; requiere confirmación y conserva la versión anterior. No sincroniza directamente con Garmin Connect.
