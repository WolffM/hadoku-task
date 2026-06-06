// Tasks tool view — shared TaskToolbar on top, then the task list. State (board,
// filter, key) lives on the shared taskApi, so this stays in sync with Calendar.
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

    // Keep the model's filter in lockstep with the shared filter.
    Binding {
        target: taskStore
        property: "filterTag"
        value: taskApi.filterTag
    }

    // --- Drag-to-tag: a small ghost follows the cursor (hotspot = cursor) ----
    function beginDrag(id, tags, title) {
        dragProxy.dragTaskId = id;
        dragProxy.dragTags = tags;
        dragProxy.label = title;
        dragProxy.Drag.active = true;
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

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        TaskToolbar {
            Layout.fillWidth: true
            placeholder: i18n("Add a task… (use #tags)")
            onSubmitText: text => taskApi.createTask(text)
            Component.onCompleted: focusEntry()
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
                    text: taskApi.filterTag ? i18n("No tasks with #%1", taskApi.filterTag) : i18n("No tasks")
                    explanation: taskApi.filterTag ? "" : i18n("Add one above to get started.")
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
                        DragHandler {
                            id: dragHandler
                            target: null
                            onActiveChanged: {
                                if (active) {
                                    page.beginDrag(row.taskId, row.tag, row.title);
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

    Component.onCompleted: taskApi.logUi("TasksToolView loaded")
}
