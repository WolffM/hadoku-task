// Shared top bar for both the Tasks and Calendar tabs: board buttons + overflow,
// an entry field, refresh + actions, and the tag-filter chip row. All state lives
// on the shared `taskApi` (board, filter, key) + `session` (pinned boards), so the
// two tabs stay in lockstep. The host wires the entry via onSubmitText.
import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts
import org.kde.kirigami as Kirigami

ColumnLayout {
    id: bar
    spacing: 0

    property string placeholder: i18n("Add a task… (use #tags)")
    signal submitText(string text)

    property var pinnedIds: session.pinnedBoards()
    readonly property var shownBoards: {
        var all = taskApi.boards;
        if (all.length <= 5)
            return all;
        var p = pinnedIds || [];
        if (p.length === 0)
            return all.slice(0, 5);
        var r = [];
        for (var i = 0; i < all.length; ++i)
            if (p.indexOf(all[i].id) >= 0)
                r.push(all[i]);
        return r.length ? r.slice(0, 5) : all.slice(0, 5);
    }

    function tagColor(tag) {
        if (!tag)
            return Kirigami.Theme.highlightColor;
        var h = 0;
        for (var i = 0; i < tag.length; ++i)
            h = (h * 31 + tag.charCodeAt(i)) & 0xffffff;
        return Qt.hsla((h % 360) / 360, 0.55, 0.5, 1.0);
    }
    function togglePin(id, on) {
        var p = (pinnedIds || []).slice();
        var i = p.indexOf(id);
        if (on && i < 0)
            p.push(id);
        else if (!on && i >= 0)
            p.splice(i, 1);
        session.setPinnedBoards(p);
        pinnedIds = p;
    }
    function submit() {
        var t = entry.text;
        if (t && t.trim().length > 0) {
            bar.submitText(t);
            entry.text = "";
        }
    }
    function focusEntry() { entry.forceActiveFocus(); }

    Connections {
        target: taskApi
        function onBusyChanged(b) { busy.running = b; }
        function onErrorOccurred(m) { banner.text = m; banner.visible = true; }
        function onBoardsChanged() { bar.pinnedIds = session.pinnedBoards(); }
    }

    // --- dialogs / menus ----------------------------------------------------
    QQC2.Dialog {
        id: keyDialog
        title: i18n("Set API key")
        modal: true
        parent: QQC2.Overlay.overlay
        anchors.centerIn: parent
        width: Math.min(bar.width - Kirigami.Units.gridUnit, Kirigami.Units.gridUnit * 20)
        standardButtons: QQC2.Dialog.Ok | QQC2.Dialog.Cancel
        onAccepted: { session.setUserKey(keyInput.text); taskApi.changeKey(keyInput.text); }
        contentItem: ColumnLayout {
            spacing: Kirigami.Units.smallSpacing
            QQC2.Label {
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
                text: i18n("Your hadoku user key. Stored in KWallet / local config; data reloads after saving.")
            }
            QQC2.TextField {
                id: keyInput
                Layout.fillWidth: true
                echoMode: TextInput.Password
                placeholderText: i18n("paste key…")
                onAccepted: keyDialog.accept()
            }
        }
        function openKey() { keyInput.text = ""; open(); keyInput.forceActiveFocus(); }
    }

    QQC2.Dialog {
        id: boardDialog
        title: i18n("New board")
        modal: true
        parent: QQC2.Overlay.overlay
        anchors.centerIn: parent
        width: Math.min(bar.width - Kirigami.Units.gridUnit, Kirigami.Units.gridUnit * 18)
        standardButtons: QQC2.Dialog.Ok | QQC2.Dialog.Cancel
        onAccepted: taskApi.createBoard(boardInput.text)
        contentItem: QQC2.TextField {
            id: boardInput
            placeholderText: i18n("Board name")
            onAccepted: boardDialog.accept()
        }
        function openNew() { boardInput.text = ""; open(); boardInput.forceActiveFocus(); }
    }

    QQC2.Dialog {
        id: confirmDelete
        property string tag: ""
        title: i18n("Delete tag")
        modal: true
        parent: QQC2.Overlay.overlay
        anchors.centerIn: parent
        width: Math.min(bar.width - Kirigami.Units.gridUnit, Kirigami.Units.gridUnit * 18)
        standardButtons: QQC2.Dialog.Ok | QQC2.Dialog.Cancel
        onAccepted: taskApi.clearTagEverywhere(tag)
        contentItem: ColumnLayout {
            QQC2.Label {
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
                text: i18n("Remove #%1 from every task on this board?", confirmDelete.tag)
            }
        }
        function openFor(t) { tag = t; open(); }
    }

    QQC2.Dialog {
        id: tagDialog
        title: i18n("New tag")
        modal: true
        parent: QQC2.Overlay.overlay
        anchors.centerIn: parent
        width: Math.min(bar.width - Kirigami.Units.gridUnit, Kirigami.Units.gridUnit * 18)
        standardButtons: QQC2.Dialog.Ok | QQC2.Dialog.Cancel
        onAccepted: taskApi.createTag(tagNameInput.text)
        contentItem: QQC2.TextField {
            id: tagNameInput
            placeholderText: i18n("tag name")
            onAccepted: tagDialog.accept()
        }
        function openNew() { tagNameInput.text = ""; open(); tagNameInput.forceActiveFocus(); }
    }

    QQC2.Menu {
        id: boardPickMenu
        Repeater {
            model: taskApi.boards
            QQC2.MenuItem {
                text: modelData.name
                checkable: true
                checked: (bar.pinnedIds || []).indexOf(modelData.id) >= 0
                onTriggered: bar.togglePin(modelData.id, checked)
            }
        }
    }

    QQC2.Menu {
        id: actionsMenu
        QQC2.MenuItem { text: i18n("Set API key…"); icon.name: "dialog-password"; onTriggered: keyDialog.openKey() }
        QQC2.MenuItem { text: i18n("New board…"); icon.name: "list-add"; onTriggered: boardDialog.openNew() }
    }

    // --- board bar ----------------------------------------------------------
    RowLayout {
        Layout.fillWidth: true
        Layout.margins: Kirigami.Units.smallSpacing
        spacing: Kirigami.Units.smallSpacing

        Flow {
            Layout.fillWidth: true
            spacing: Kirigami.Units.smallSpacing
            Repeater {
                model: bar.shownBoards
                FilterChip {
                    label: modelData.name
                    accent: Kirigami.Theme.highlightColor
                    active: taskApi.currentBoardId === modelData.id
                    onClicked: taskApi.switchBoard(modelData.id)
                }
            }
            QQC2.ToolButton {
                visible: taskApi.boards.length > 5
                icon.name: "application-menu"
                QQC2.ToolTip.text: i18n("Choose boards")
                QQC2.ToolTip.visible: hovered
                onClicked: boardPickMenu.popup()
            }
        }
        QQC2.ToolButton {
            icon.name: "view-refresh"
            QQC2.ToolTip.text: i18n("Refresh")
            QQC2.ToolTip.visible: hovered
            onClicked: taskApi.reload()
        }
        QQC2.ToolButton {
            icon.name: "application-menu"
            QQC2.ToolTip.text: i18n("Actions")
            QQC2.ToolTip.visible: hovered
            onClicked: actionsMenu.popup()
        }
    }

    // --- entry --------------------------------------------------------------
    RowLayout {
        Layout.fillWidth: true
        Layout.leftMargin: Kirigami.Units.smallSpacing
        Layout.rightMargin: Kirigami.Units.smallSpacing
        Layout.bottomMargin: Kirigami.Units.smallSpacing
        spacing: Kirigami.Units.smallSpacing
        QQC2.TextField {
            id: entry
            Layout.fillWidth: true
            placeholderText: bar.placeholder
            onAccepted: bar.submit()
        }
        QQC2.BusyIndicator {
            id: busy
            running: false
            Layout.preferredHeight: entry.height
            Layout.preferredWidth: entry.height
        }
    }

    // --- tag filter ---------------------------------------------------------
    Flow {
        Layout.fillWidth: true
        Layout.leftMargin: Kirigami.Units.smallSpacing
        Layout.rightMargin: Kirigami.Units.smallSpacing
        Layout.bottomMargin: Kirigami.Units.smallSpacing
        spacing: Kirigami.Units.smallSpacing

        FilterChip {
            label: i18n("All")
            accent: Kirigami.Theme.highlightColor
            visible: taskApi.allTags.length > 0
            active: taskApi.filterTag === ""
            onClicked: taskApi.filterTag = ""
        }
        Repeater {
            model: taskApi.allTags
            FilterChip {
                label: modelData
                tagValue: modelData
                accent: bar.tagColor(modelData)
                active: taskApi.filterTag === modelData
                onClicked: taskApi.filterTag = (taskApi.filterTag === modelData ? "" : modelData)
                onTaskDropped: (taskId, currentTags) => taskApi.addTaskTag(taskId, modelData)
                onDeleteRequested: t => confirmDelete.openFor(t)
            }
        }
        QQC2.ToolButton {
            icon.name: "list-add"
            display: QQC2.AbstractButton.IconOnly
            text: i18n("New tag")
            QQC2.ToolTip.text: text
            QQC2.ToolTip.visible: hovered
            onClicked: tagDialog.openNew()
        }
    }

    Kirigami.InlineMessage {
        id: banner
        Layout.fillWidth: true
        Layout.leftMargin: Kirigami.Units.smallSpacing
        Layout.rightMargin: Kirigami.Units.smallSpacing
        type: Kirigami.MessageType.Warning
        showCloseButton: true
        visible: false
    }
}
