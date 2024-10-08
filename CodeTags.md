
# VS Code Extension - CodeTags Feature

**CodeTags** is a powerful feature within this VS Code extension that dynamically parses a header file (`maestro.h`) to inject useful variables like build versions, timestamps, and more into your code. This helps streamline the process of keeping metadata up-to-date by automating the insertion of values such as the current date, build number, and random hexadecimal values.

## CodeTags Overview

CodeTags scans for a specific header file (`maestro.h`) in your project, evaluates any directives it contains, and injects the corresponding values. This feature is especially useful for embedding dynamically generated metadata (e.g., dates, version numbers) into your codebase, eliminating the need for manual updates.

## Key Features

- **Dynamic Metadata Insertion**: Automatically generates and updates code variables like year, month, build number, and more.
- **JavaScript-based Evaluation**: Uses JavaScript expressions to calculate values, providing flexibility and precision.
- **Environment and Workspace Integration**: Easily references environment variables and workspace-specific paths.

## Example `maestro.h`

Here’s an example of what a `maestro.h` file might look like when using **CodeTags**:

```c
#pragma once

// OTX_Extension_print(#define PROJECTNAME = '${workspaceFolderBasename}')
#define PROJECTNAME = 'OTX-HelloWorld'

// OTX_Extension_print(#define ONETHINX_PACK_LOC = '${env:ONETHINX_PACK_LOC}')
#define ONETHINX_PACK_LOC = '/Applications/OTX-Maestro'

// OTX_Extension_eval("#define year " + new Date().getFullYear() % 100 )
#define year 24

// OTX_Extension_eval( "#define month " + ("0" + (new Date().getMonth()+1)).slice(-2) )
#define month 07

// OTX_Extension_eval( "#define day " + ("0" + new Date().getDate()).slice(-2) )
#define day 30

// OTX_Extension_eval( "#define hour " + ("0" + new Date().getHours()).slice(-2) )
#define hour 16

// OTX_Extension_eval( "#define minute " + ("0" + new Date().getMinutes()).slice(-2) )
#define minute 06

// OTX_Extension_eval( "#define second " + ("0" + new Date().getSeconds()).slice(-2) )
#define second 13

// OTX_Extension_eval( "#define buildNr " + (${nextLineValue}+1) )
#define buildNr 52

// OTX_Extension_eval( "#define random 0x" + (Math.floor(Math.random() * 0x100000000)).toString(16).padStart(8, '0').toUpperCase(); )
#define random 0xF3DF2754
```

In this file, **CodeTags** automatically evaluates and updates the variables based on JavaScript expressions, such as inserting the current year, month, day, or a randomly generated hexadecimal value.

## How to Use CodeTags

1. **Create `maestro.h`**: In your workspace, create a file named `maestro.h` in the `source` folder where you can add variable definitions that need to be dynamically updated by CodeTags.
2. **Add Directives**: Use `OTX_Extension_print` for static values like environment variables or workspace-specific names, and `OTX_Extension_eval` for dynamic JavaScript-based values.
3. **Automatic Parsing**: When you use your extension, CodeTags will parse the `maestro.h` file, evaluate the expressions, and insert the appropriate values in place of the directives.

### Supported Directives

- **`OTX_Extension_print`**: Injects static values or metadata such as workspace folder names or environment variables.  
  Example:
  
```
// OTX_Extension_print(#define PROJECTNAME = '${workspaceFolderBasename}')
#define PROJECTNAME = 'OTX-HelloWorld'
```

- **`OTX_Extension_eval`**: Evaluates JavaScript expressions and inserts dynamic values into the code.  
  Example:  
```
// OTX_Extension_eval("#define year " + new Date().getFullYear() % 100)
#define year 24
```

### Practical Use Cases

- **Version Control**: Automatically increment build numbers using `buildNr` without manual intervention.
- **Timestamps**: Add current date and time in your header file for documentation or version tracking.
- **Randomization**: Generate random values, like a unique session ID, using the random hexadecimal functionality.

## Configuration

No additional configuration is required to start using **CodeTags**. Just ensure that a `maestro.h` file is present in your project root, and the extension will handle the rest.

