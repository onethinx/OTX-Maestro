# Onethinx OTX Maestro README

OTX Maestro is a Visual Studio Code extension designed to streamline the development of applications for the OTX-18 LoRaWAN module. Leveraging the Meson build system and the GNU ARM toolchain, OTX Maestro provides an integrated development environment within VS Code that simplifies building, compiling, and debugging projects. This extension is tailored for developers working with the OTX-18, enabling efficient and effective application development for LoRaWAN-based solutions.

## Features

- **Easy Setup**: Quick and straightforward installation and configuration within Visual Studio Code.
- **Easy Build and Program/Debug**: Simplified processes for building, programming, and debugging applications.
- **Fully Integrated with VS Code**: Seamless integration with the Visual Studio Code environment, leveraging its tools and extensions.
- **Enhanced User Experience**: Optimized interface and workflows to improve productivity and development experience.
- **IntelliSense for C/C++**: Advanced code completion, linting, and syntax highlighting for C/C++ development.
- **CodeTagging**: [CodeTags](https://github.com/onethinx/OTX-Maestro/blob/main/CodeTags.md) parses the `maestro.h` header file to dynamically inject dates, build versions, and custom variables into your code.

## Installation

  - OTX Maestro Tools (all the tools in one bundle such as the ARM GCC Compiler, OpenOCD for programming / debugging etc.)
    - [Download the latest OTX-Maestro Tools from here](https://github.com/onethinx/OTX-Maestro/releases) and install.<br><br>
  - Install the OTX-Maestro extension
    - Open the Extension view by clicking the Extensions icon or press `Shift + CTRL/Command + X`
    ![](https://raw.githubusercontent.com/onethinx/Readme_assets/main/OTX_Maestro-install.png) <br><br>
    - Type `otx` in the searchbar and find the `OTX Maestro` Extension pack
    - Click `Install` and wait for the extension to get installed
    - **Important**: Close VS Code before using to make sure the environment variables are loaded at starting VS Code (MAC users must fully quit VSCode, there shoud not be the white dot below the VSCode) <br><br>

## Requirements

- Windows, macOS, or Linux
- Visual Studio Code
- [OTX Maestro Tools](https://github.com/onethinx/OTX-Maestro/releases)

## Known Issues

None reported to date.

**Enjoy!**
