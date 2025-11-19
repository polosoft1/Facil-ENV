# 🐍 Easy Env — Administrador visual de entornos Python para VS Code

**Install Facil ENV**

![Texto alternativo](https://raw.githubusercontent.com/nepolBancolombiaSoft/ChatbotIA_WIKI/refs/heads/main/Instalacion.gif)

**Crear un entorno .ENV**

![Texto alternativo](https://raw.githubusercontent.com/nepolBancolombiaSoft/ChatbotIA_WIKI/refs/heads/main/crear_env.gif)

**Acciones en Facil .ENV**

![Texto alternativo](https://raw.githubusercontent.com/polosoft1/Facil-ENV/refs/heads/main/media/GIF/acciones.gif)

**Easy Env** es una extensión diseñada para gestionar entornos Python de forma simple, visual y veloz, directamente desde VS Code.  
Incluye un **Dashboard DevOps**, administración completa de entornos `venv`, manejo de paquetes, activación en terminal y automatización de tareas comunes.

**Importante**
dejar que la extencion controle los entornos de python :
  1. si Auto-activación Python: Activada ( ponerlo en desactivado)
  2. Dar clic en boton : Alternar auto-activación Python 
---

## ⭐ Características principales

✔ Crear o eliminar entornos Python  
✔ Activar entornos en terminal  
✔ Ver y administrar paquetes (`pip list`, instalar, desinstalar)  
✔ Usar un entorno como intérprete del workspace  
✔ Abrir la carpeta del entorno  
✔ Abrir terminal ubicada en el entorno  
✔ Dashboard visual con métricas del proyecto  
✔ Botones de acción rápida  
✔ Compatibilidad total: Windows / Linux / macOS  

---

## 📊 Dashboard DevOps (Vista interactiva)

La vista Dashboard incluye:

- Entorno activo  
- Versión Python  
- Ruta del entorno  
- Número total de entornos  
- Filtros por versión  
- Acciones rápidas (crear entorno, instalar paquete, refrescar, ver paquetes, etc.)  
- Tabla con todos los entornos detectados  

![Dashboard Preview](https://github.com/polosoft1/Facil-ENV/blob/main/media/GIF/Dashboard.gif?raw=true)


![Dashboard Preview](https://raw.githubusercontent.com/polosoft1/Facil-ENV/refs/heads/main/media/das.png)

---

## ⚡ Comandos disponibles

Puedes acceder desde la vista lateral **Easy Env** o desde la Palette (`Ctrl+Shift+P`).

| Comando | Acción |
|--------|--------|
| **Easy Env: Crear entorno venv** | Crea un nuevo entorno virtual. |
| **Easy Env: Activar entorno** | Abre terminal con el entorno activado. |
| **Easy Env: Usar como intérprete del workspace** | Cambia el intérprete Python del proyecto. |
| **Easy Env: Ver paquetes (pip list)** | Muestra los paquetes instalados. |
| **Easy Env: Instalar paquete** | Instala un paquete con pip. |
| **Easy Env: Desinstalar paquete** | Elimina un paquete. |
| **Easy Env: Abrir carpeta del entorno** | Abre la ruta en el explorador. |
| **Easy Env: Abrir terminal en entorno** | Terminal directamente en la carpeta. |
| **Easy Env: Eliminar entorno** | Borra completamente el entorno. |

---

## 🧱 Cómo funciona

Easy Env detecta entornos Python dentro del workspace revisando carpetas que contienen:

- `Scripts/python.exe` (Windows)  
- `bin/python` o `bin/python3` (Linux/macOS)


🧪 Compatibilidad
Sistema	Estado
Windows	✔
macOS	✔
Linux	✔
Python 3.8 → 3.13	✔


👨‍💻 Autor

Nelson Enrique Polo
📧 polosoft1@gmail.com

🔗 GitHub: https://github.com/polosoft1/Facil-ENV/

Desarrollado con asistencia de IA – 2025.

📄 Licencia

MIT License.