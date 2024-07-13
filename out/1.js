"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExampleViewProvider = void 0;
const vscode = require("vscode");
class ExampleViewProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        const item1 = new ExampleTreeItem('Item 1', 'exampleView.itemClicked', 'Item 1 clicked');
        const item2 = new ExampleTreeItem('Item 2', 'exampleView.itemClicked', 'Item 2 clicked');
        const item3 = new ExampleTreeItem('Item 3', 'exampleView.itemClicked', 'Item 3 clicked');
        this.items = [item1, item2, item3];
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    refreshItem(item) {
        this._onDidChangeTreeData.fire(item);
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (element) {
            return Promise.resolve([]); // No children in this example
        }
        else {
            return Promise.resolve(this.items);
        }
    }
}
exports.ExampleViewProvider = ExampleViewProvider;
//# sourceMappingURL=1.js.map