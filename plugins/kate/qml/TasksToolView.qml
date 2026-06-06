// Tasks tool view — Kirigami list backed by the C++ TaskStore/TaskApiClient,
// exposed as context properties `taskStore` and `taskApi`. Fully fluid: every
// element fills width and the list fills remaining height, so it tracks the
// sidebar as it is resized.
import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts
import org.kde.kirigami as Kirigami

Kirigami.Page {
    id: page
    padding: 0
    title: i18n("Tasks")

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

    Connections {
        target: taskApi
        function onErrorOccurred(message) {
            banner.text = message;
            banner.visible = true;
        }
        function onBusyChanged(busy) {
            busyIndicator.running = busy;
        }
    }

    Connections {
        target: taskStore
        function onCountChanged() {
            taskApi.logUi("taskStore.count=" + taskStore.count + " list.count=" + list.count
                + " list[w x h]=" + Math.round(list.width) + "x" + Math.round(list.height)
                + " page[w x h]=" + Math.round(page.width) + "x" + Math.round(page.height));
        }
    }

    // --- Edit-tags dialog ----------------------------------------------------
    QQC2.Dialog {
        id: tagDialog
        property string taskId: ""
        title: i18n("Edit tags")
        modal: true
        parent: QQC2.Overlay.overlay
        anchors.centerIn: parent
        width: Math.min(page.width - Kirigami.Units.gridUnit, Kirigami.Units.gridUnit * 18)
        standardButtons: QQC2.Dialog.Ok | QQC2.Dialog.Cancel
        onAccepted: taskApi.setTaskTags(taskId, tagInput.text)
        contentItem: ColumnLayout {
            spacing: Kirigami.Units.smallSpacing
            QQC2.Label {
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
                text: i18n("Space-separated tags")
            }
            QQC2.TextField {
                id: tagInput
                Layout.fillWidth: true
                placeholderText: i18n("work urgent")
                onAccepted: tagDialog.accept()
            }
        }
        function openFor(id, tags) {
            taskId = id;
            tagInput.text = tags || "";
            open();
            tagInput.forceActiveFocus();
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

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        // --- Board selector ---------------------------------------------
        RowLayout {
            Layout.fillWidth: true
            Layout.margins: Kirigami.Units.smallSpacing
            spacing: Kirigami.Units.smallSpacing

            QQC2.ComboBox {
                id: boardCombo
                Layout.fillWidth: true
                model: taskApi.boards
                textRole: "name"
                valueRole: "id"
                currentIndex: Math.max(0, indexOfValue(taskApi.currentBoardId))
                onActivated: taskApi.switchBoard(currentValue)
            }
            QQC2.ToolButton {
                icon.name: "view-list-text"
                text: i18n("New board")
                display: QQC2.AbstractButton.IconOnly
                QQC2.ToolTip.text: text
                QQC2.ToolTip.visible: hovered
                onClicked: boardDialog.openNew()
            }
        }

        // --- Quick add ---------------------------------------------------
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
            QQC2.ToolButton {
                icon.name: "list-add"
                display: QQC2.AbstractButton.IconOnly
                text: i18n("Add task")
                QQC2.ToolTip.text: text
                QQC2.ToolTip.visible: hovered
                onClicked: page.submitAdd()
            }
            QQC2.BusyIndicator {
                id: busyIndicator
                running: false
                Layout.preferredHeight: addField.height
                Layout.preferredWidth: addField.height
            }
        }

        // --- Tag filter chips -------------------------------------------
        Flow {
            id: tagFilter
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
                    accent: page.tagColor(modelData)
                    active: taskStore.filterTag === modelData
                    onClicked: taskStore.filterTag = (taskStore.filterTag === modelData ? "" : modelData)
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
                reuseItems: true
                spacing: 0

                Kirigami.PlaceholderMessage {
                    anchors.centerIn: parent
                    width: parent.width - Kirigami.Units.gridUnit * 4
                    visible: list.count === 0
                    icon.name: "checkmark"
                    text: taskStore.filterTag ? i18n("No tasks with #%1", taskStore.filterTag) : i18n("No tasks")
                    explanation: taskStore.filterTag ? "" : i18n("Add one above to get started.")
                }

                delegate: QQC2.ItemDelegate {
                    id: row
                    width: ListView.view.width
                    hoverEnabled: true
                    // Capture model roles into plain properties so nested Repeaters
                    // don't shadow `model`.
                    required property string taskId
                    required property string title
                    required property string tag
                    required property bool isScheduled
                    required property string startTime
                    required property string endTime
                    height: Math.max(implicitContentHeight + Kirigami.Units.smallSpacing * 2,
                                     Kirigami.Units.gridUnit * 2)

                    contentItem: RowLayout {
                        spacing: Kirigami.Units.smallSpacing

                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 2
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
                                        implicitHeight: t.implicitHeight + 2
                                        implicitWidth: t.implicitWidth + Kirigami.Units.largeSpacing
                                        QQC2.Label {
                                            id: t
                                            anchors.centerIn: parent
                                            text: modelData
                                            color: "white"
                                            font: Kirigami.Theme.smallFont
                                        }
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
                            icon.name: "tag"
                            opacity: row.hovered ? 1 : 0.3
                            QQC2.ToolTip.text: i18n("Edit tags")
                            QQC2.ToolTip.visible: hovered
                            onClicked: tagDialog.openFor(row.taskId, row.tag)
                        }
                        QQC2.ToolButton {
                            icon.name: "checkmark"
                            opacity: row.hovered ? 1 : 0.3
                            QQC2.ToolTip.text: i18n("Complete")
                            QQC2.ToolTip.visible: hovered
                            onClicked: taskApi.completeTask(row.taskId)
                        }
                        QQC2.ToolButton {
                            icon.name: "edit-delete"
                            opacity: row.hovered ? 1 : 0.3
                            QQC2.ToolTip.text: i18n("Delete")
                            QQC2.ToolTip.visible: hovered
                            onClicked: taskApi.deleteTask(row.taskId)
                        }
                    }
                }
            }
        }
    }

    function submitAdd() {
        var t = addField.text;
        taskApi.logUi("submitAdd: text='" + t + "'");
        if (t && t.trim().length > 0) {
            taskApi.createTask(t);
            addField.text = "";
        }
    }

    Component.onCompleted: {
        taskApi.logUi("TasksToolView loaded");
        addField.forceActiveFocus();
    }
}
