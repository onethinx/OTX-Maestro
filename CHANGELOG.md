# Change Log

## 1.1.2

- Minor fix at project load where status / taskbar didn't load correctly

## 1.1.1

- Streamlined project updating

## 1.1.0

- Fixed project check at extension startup
- Fixed global settings save

### 1.0.9

- Added ChirpStack provisioning for OTX-18 modules
- Added Sidebar Icon and configurable buttons (via tasks.json)

### 1.0.8

- Minor fix for build file parsing issue when both CMakeLists.txt and meson.build are present

### 1.0.7

- Implemented autodetection of PSoC Creator (.cydsn) folder (needs project version >= 1.0.5)

### 1.0.6

- Fixed issue where tasks didn't execute as provided
- Added support for dual core PSoC5 project building (by using folder tags in the build file: eg: `(folder:source/CortexM4)`)
- Added CMake support
- Improved Clean / Build logic

### 1.0.5

- Various fixes (statusbar buttons etc.)

### 1.0.4

- Various fixes (version updating, project check etc.)

### 1.0.3

- Standalone extension
- Improved project update option

### 1.0.2

- Several improvements, including a programmer selection
- Project update function

### 1.0.1

- Enhanced building with Meson

### 1.0.0

- Initial release of OTX Maestro, based on e.GO Powertools and CMake for building