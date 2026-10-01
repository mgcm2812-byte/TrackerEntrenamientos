# Rompesuelas · entrenamiento híbrido

Aplicación personal local para planificar carrera y fuerza, registrar actividades FIT/GPX y conservar el historial de cada versión del plan.

## Requisitos

- Node.js 22.12 o posterior (la base SQLite usa `node:sqlite`).
- pnpm 9 o posterior.
- Python 3.12 o posterior, solo si quieres importar directamente desde Garmin Connect.

## Ejecutar en desarrollo

```powershell
pnpm install
pnpm dev
```

Abre la dirección local que muestre Vite, normalmente `http://localhost:5173`. Para entrar desde un teléfono conectado a la misma Wi-Fi, abre en el teléfono la dirección de red local que muestre la terminal. Windows puede pedir permiso para permitir conexiones privadas; habilita la red privada para que el teléfono alcance el ordenador.

La conexión directa con Garmin Connect está disponible únicamente en el navegador del propio ordenador; no se habilita desde el teléfono ni desde otro equipo de la red. Instala el paquete `garminconnect` (del proyecto Python `python-garminconnect`) y su dependencia `curl_cffi` una vez desde PowerShell:

```powershell
python -m pip install -r requirements-garmin.txt
```

Si Python no está en `PATH`, configura `GARMIN_PYTHON` con la ruta al ejecutable antes de iniciar la aplicación. La contraseña se usa durante el inicio de sesión y no se guarda. Los tokens de sesión se conservan por usuario en la carpeta local `data/garmin/`; desconectar Garmin elimina esos tokens. Selecciona un rango de fechas (hasta 366 días), revisa la lista y marca las actividades que quieras añadir. El proceso usa el cliente comunitario `garminconnect`.

### Enviar el plan semanal por correo

En **Mi plan**, el botón **Enviar semana actual por correo** manda manualmente el calendario de lunes a domingo a `mgcm2812@gmail.com`. Incluye las sesiones programadas, instrucciones y ejercicios de fuerza. Para habilitarlo, copia `.env.example` a `.env` y configura `SMTP_USER` con una cuenta Gmail y `SMTP_PASS` con una contraseña de aplicación de Google. No uses la contraseña habitual de Gmail. El servidor, puerto y TLS ya están configurados para Gmail. Deja `SMTP_FROM` igual a `SMTP_USER`, salvo que tengas configurado un alias de envío autorizado en Gmail. Reinicia la aplicación después de modificar `.env`. El archivo `.env` está excluido de Git y las credenciales no se guardan en la base de datos ni se envían al navegador.

El acceso local usa HTTP y no configura TLS. Úsalo solo en una red privada de confianza y no publiques ni redirijas el puerto a Internet.

El acceso inicial es `admin` con contraseña `admin`. Desde la pantalla de acceso puedes entrar con esa cuenta o crear usuarios nuevos; cada usuario tiene un login propio y una contraseña de al menos 6 caracteres. Las contraseñas se almacenan como hash scrypt en la base local y los perfiles, objetivos, planes y actividades quedan separados por cuenta. El administrador puede borrar los datos de una cuenta, restablecer su contraseña o eliminarla por completo desde **Administración**. La cuenta admin está protegida contra eliminación. Las sesiones se invalidan al reiniciar el servidor.

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

La planificación inicial cubre metas de 5K, 10K y media maratón, con progresión por fases y semanas de descarga. La reevaluación local propone ajustes según RPE, molestias y sesiones omitidas; requiere confirmación y conserva la versión anterior.
