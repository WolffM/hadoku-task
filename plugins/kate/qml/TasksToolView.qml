// Tasks tool view — Kirigami list backed by the C++ TaskStore/TaskApiClient/
// SessionManager (context properties taskStore, taskApi, session). Fully fluid.
import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts
import org.kde.kirigami as Kirigami

Kirigami.Page {
    id: page
    padding: 0
    title: i18n("Tasks")

    // Board ids the user pinned to the bar (persisted via SessionManager).
    property var pinnedIds: session.pinnedBoards()

    // Boards shown as buttons: all if <=5, else the pinned set (default first 5).
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
            return Kirigami.Theme.disabledTextColor;
        var h = 0;
        for (var i = 0; i < tag.length; ++i)
            h = (h * 31 + tag.charCodeAt(i)) & 0xffffff;
        return Qt.hsla((h % 360) / 360, 0.55, 0.5, 1.0);
    }

    function fmtTime(iso) {
        if (!iso)
            return "";
        var d = new Date(iso);
        return isNaN(d.getTime()) ? "" : Qt.formatDateTime(d, "ddd HH:mm");
    }

    function splitTags(s) {
        return s ? s.split(" ").filter(Boolean) : [];
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

    function submitAdd() {
        var t = addField.text;
        if (t && t.trim().length > 0) {
            taskApi.createTask(t);
            addField.text = "";
        }
    }

    // --- Drag-to-tag: a small ghost follows the cursor (hotspot = cursor) ----
    function beginDrag(id, tags, title) {
        dragProxy.dragTaskId = id;
        dragProxy.dragTags = tags;
        dragProxy.label = title;
        dragProxy.Drag.active = true;
        // Stay hidden until positioned (updateDrag) so it never flashes at the
        // previous drag's location.
    }
    function updateDrag(scenePos) {
        var p = page.mapFromItem(null, scenePos.x, scenePos.y);
        dragProxy.x = p.x - dragProxy.width / 2;
        dragProxy.y = p.y - dragProxy.height / 2;
        dragProxy.visible = true;
    }
    function finishDrag() {
        dragProxy.Drag.drop();
        dragProxy.Drag.active = false;
        dragProxy.visible = false;
    }

    Item {
        id: dragProxy
        parent: page
        z: 99999
        visible: false
        property string dragTaskId: ""
        property string dragTags: ""
        property string label: ""
        width: proxyLabel.implicitWidth + Kirigami.Units.largeSpacing
        height: proxyLabel.implicitHeight + Kirigami.Units.smallSpacing
        Drag.source: dragProxy
        Drag.hotSpot.x: width / 2
        Drag.hotSpot.y: height / 2
        Rectangle {
            anchors.fill: parent
            radius: height / 2
            color: Kirigami.Theme.highlightColor
            opacity: 0.92
            QQC2.Label {
                id: proxyLabel
                anchors.centerIn: parent
                text: dragProxy.label
                color: "white"
                font: Kirigami.Theme.smallFont
            }
        }
    }

    Connections {
        target: taskApi
        function onErrorOccurred(message) {
            banner.text = message;
            banner.visible = true;
        }
        function onBusyChanged(busy) {
            busyIndicator.running = busy;
        }
        function onBoardsChanged() {
            page.pinnedIds = session.pinnedBoards();
        }
    }

    // --- API key dialog ------------------------------------------------------
    QQC2.Dialog {
        id: keyDialog
        title: i18n("Set API key")
        modal: true
        parent: QQC2.Overlay.overlay
        anchors.centerIn: parent
        width: Math.min(page.width - Kirigami.Units.gridUnit, Kirigami.Units.gridUnit * 20)
        standardButtons: QQC2.Dialog.Ok | QQC2.Dialog.Cancel
        onAccepted: {
            session.setUserKey(keyInput.text);
            taskApi.changeKey(keyInput.text);
        }
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
        function openKey() {
            keyInput.text = "";
            open();
            keyInput.forceActiveFocus();
        }
    }

    // --- New-board dialog ----------------------------------------------------
    QQC2.Dialog {
        id: boardDialog
        title: i18n("New board")
        modal: true
        parent: QQC2.Overlay.overlay
        anchors.centerIn: parent
        width: Math.min(page.width - Kirigami.Units.gridUnit, Kirigami.Units.gridUnit * 18)
        standardButtons: QQC2.Dialog.Ok | QQC2.Dialog.Cancel
        onAccepted: taskApi.createBoard(boardInput.text)
        contentItem: QQC2.TextField {
            id: boardInput
            placeholderText: i18n("Board name")
            onAccepted: boardDialog.accept()
        }
        function openNew() {
            boardInput.text = "";
            open();
            boardInput.forceActiveFocus();
        }
    }

    // --- Confirm "delete tag everywhere" ------------------------------------
    QQC2.Dialog {
        id: confirmDelete
        property string tag: ""
        title: i18n("Delete tag")
        modal: true
        parent: QQC2.Overlay.overlay
        anchors.centerIn: parent
        width: Math.min(page.width - Kirigami.Units.gridUnit, Kirigami.Units.gridUnit * 18)
        standardButtons: QQC2.Dialog.Ok | QQC2.Dialog.Cancel
        onAccepted: taskApi.clearTagEverywhere(tag)
        contentItem: QQC2.Label {
            wrapMode: Text.WordWrap
            text: i18n("Remove #%1 from every task on this board?", confirmDelete.tag)
        }
        function openFor(t) {
            tag = t;
            open();
        }
    }

    QQC2.Menu {
        id: boardPickMenu
        Repeater {
            model: taskApi.boards
            QQC2.MenuItem {
                text: modelData.name
                checkable: true
                checked: (page.pinnedIds || []).indexOf(modelData.id) >= 0
                onTriggered: page.togglePin(modelData.id, checked)
            }
        }
    }

    QQC2.Menu {
        id: actionsMenu
        QQC2.MenuItem {
            text: i18n("Set API key…")
            icon.name: "dialog-password"
            onTriggered: keyDialog.openKey()
        }
        QQC2.MenuItem {
            text: i18n("New board…")
            icon.name: "list-add"
            onTriggered: boardDialog.openNew()
        }
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        // --- Board bar ---------------------------------------------------
        RowLayout {
            Layout.fillWidth: true
            Layout.margins: Kirigami.Units.smallSpacing
            spacing: Kirigami.Units.smallSpacing

            Flow {
                Layout.fillWidth: true
                spacing: Kirigami.Units.smallSpacing
                Repeater {
                    model: page.shownBoards
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

        // --- Quick add (Enter submits; no button) -----------------------
        RowLayout {
            Layout.fillWidth: true
            Layout.leftMargin: Kirigami.Units.smallSpacing
            Layout.rightMargin: Kirigami.Units.smallSpacing
            Layout.bottomMargin: Kirigami.Units.smallSpacing
            spacing: Kirigami.Units.smallSpacing

            QQC2.TextField {
                id: addField
                Layout.fillWidth: true
                focus: true
                placeholderText: i18n("Add a task… (use #tags)")
                onAccepted: page.submitAdd()
            }
            QQC2.BusyIndicator {
                id: busyIndicator
                running: false
                Layout.preferredHeight: addField.height
                Layout.preferredWidth: addField.height
            }
        }

        // --- Tag filter / drop targets ----------------------------------
        Flow {
            Layout.fillWidth: true
            Layout.leftMargin: Kirigami.Units.smallSpacing
            Layout.rightMargin: Kirigami.Units.smallSpacing
            Layout.bottomMargin: Kirigami.Units.smallSpacing
            spacing: Kirigami.Units.smallSpacing
            visible: taskApi.allTags.length > 0

            FilterChip {
                label: i18n("All")
                accent: Kirigami.Theme.highlightColor
                active: taskStore.filterTag === ""
                onClicked: taskStore.filterTag = ""
            }
            Repeater {
                model: taskApi.allTags
                FilterChip {
                    label: modelData
                    tagValue: modelData
                    accent: page.tagColor(modelData)
                    active: taskStore.filterTag === modelData
                    onClicked: taskStore.filterTag = (taskStore.filterTag === modelData ? "" : modelData)
                    onTaskDropped: (taskId, currentTags) => taskApi.addTaskTag(taskId, modelData)
                    onDeleteRequested: t => confirmDelete.openFor(t)
                }
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

        Kirigami.Separator { Layout.fillWidth: true }

        // --- Task list ---------------------------------------------------
        QQC2.ScrollView {
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true

            ListView {
                id: list
                model: taskStore
                currentIndex: -1
                spacing: 0

                Kirigami.PlaceholderMessage {
                    anchors.centerIn: parent
                    width: parent.width - Kirigami.Units.gridUnit * 4
                    visible: list.count === 0
                    icon.name: "checkmark"
                    text: taskStore.filterTag ? i18n("No tasks with #%1", taskStore.filterTag) : i18n("No tasks")
                    explanation: taskStore.filterTag ? "" : i18n("Add one above to get started.")
                }

                delegate: Item {
                    id: row
                    width: ListView.view.width
                    height: content.implicitHeight + Kirigami.Units.smallSpacing * 2
                    required property string taskId
                    required property string title
                    required property string tag
                    required property bool isScheduled
                    required property string startTime
                    required property string endTime

                    Rectangle {
                        id: card
                        width: row.width
                        height: row.height
                        radius: 4
                        opacity: dragHandler.active ? 0.4 : 1
                        color: hover.hovered ? Qt.alpha(Kirigami.Theme.highlightColor, 0.08) : "transparent"

                        HoverHandler { id: hover }
                        // Card stays put; a page-level ghost (dragProxy) follows the
                        // cursor so the drop hotspot tracks the pointer, not the card.
                        DragHandler {
                            id: dragHandler
                            target: null
                            onActiveChanged: {
                                if (active) {
                                    page.beginDrag(row.taskId, row.tag, row.title);
                                    // Position at the grab point immediately, before
                                    // the ghost is shown.
                                    page.updateDrag(centroid.scenePosition);
                                } else {
                                    page.finishDrag();
                                }
                            }
                            onCentroidChanged: if (active) page.updateDrag(centroid.scenePosition)
                        }

                        RowLayout {
                            id: content
                            anchors.fill: parent
                            anchors.leftMargin: Kirigami.Units.smallSpacing
                            anchors.rightMargin: Kirigami.Units.smallSpacing
                            spacing: Kirigami.Units.smallSpacing

                            ColumnLayout {
                                Layout.fillWidth: true
                                Layout.topMargin: Kirigami.Units.smallSpacing
                                Layout.bottomMargin: Kirigami.Units.smallSpacing
                                spacing: Kirigami.Units.smallSpacing

                                QQC2.Label {
                                    Layout.fillWidth: true
                                    text: row.title
                                    elide: Text.ElideRight
                                }
                                Flow {
                                    Layout.fillWidth: true
                                    spacing: Kirigami.Units.smallSpacing
                                    visible: row.tag.length > 0 || row.isScheduled
                                    Repeater {
                                        model: page.splitTags(row.tag)
                                        Rectangle {
                                            radius: height / 2
                                            color: page.tagColor(modelData)
                                            implicitHeight: t.implicitHeight + Kirigami.Units.smallSpacing
                                            implicitWidth: t.implicitWidth + Kirigami.Units.largeSpacing
                                            QQC2.Label {
                                                id: t
                                                anchors.centerIn: parent
                                                text: modelData
                                                color: "white"
                                                font: Kirigami.Theme.smallFont
                                            }
                                            HoverHandler { id: pillHover }
                                            TapHandler {
                                                acceptedButtons: Qt.RightButton
                                                onTapped: taskApi.removeTaskTag(row.taskId, modelData)
                                            }
                                            QQC2.ToolTip.visible: pillHover.hovered
                                            QQC2.ToolTip.text: i18n("Right-click to remove tag")
                                        }
                                    }
                                    RowLayout {
                                        spacing: 2
                                        visible: row.isScheduled
                                        Kirigami.Icon {
                                            source: "clock"
                                            implicitWidth: Kirigami.Units.iconSizes.small
                                            implicitHeight: Kirigami.Units.iconSizes.small
                                        }
                                        QQC2.Label {
                                            text: row.endTime ? page.fmtTime(row.startTime) + "–" + page.fmtTime(row.endTime)
                                                              : page.fmtTime(row.startTime)
                                            font: Kirigami.Theme.smallFont
                                            opacity: 0.8
                                        }
                                    }
                                }
                            }

                            QQC2.ToolButton {
                                icon.name: "checkmark"
                                opacity: hover.hovered ? 1 : 0.3
                                QQC2.ToolTip.text: i18n("Complete")
                                QQC2.ToolTip.visible: hovered
                                onClicked: taskApi.completeTask(row.taskId)
                            }
                            QQC2.ToolButton {
                                icon.name: "edit-delete"
                                opacity: hover.hovered ? 1 : 0.3
                                QQC2.ToolTip.text: i18n("Delete")
                                QQC2.ToolTip.visible: hovered
                                onClicked: taskApi.deleteTask(row.taskId)
                            }
                        }
                    }
                }
            }
        }
    }

    Component.onCompleted: {
        taskApi.logUi("TasksToolView loaded");
        addField.forceActiveFocus();
    }
}
