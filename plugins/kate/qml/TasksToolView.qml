// Tasks tool view — Kirigami list backed by the C++ TaskStore/TaskApiClient,
// exposed as context properties `taskStore` and `taskApi`.
import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts
import org.kde.kirigami as Kirigami

Kirigami.Page {
    id: page
    padding: 0
    title: i18n("Tasks")

    // Deterministic-ish accent color per tag so chips are visually distinct.
    function tagColor(tag) {
        if (!tag)
            return Kirigami.Theme.disabledTextColor;
        var h = 0;
        for (var i = 0; i < tag.length; ++i)
            h = (h * 31 + tag.charCodeAt(i)) & 0xffffff;
        return Qt.hsla((h % 360) / 360, 0.55, 0.55, 1.0);
    }

    function fmtTime(iso) {
        if (!iso)
            return "";
        var d = new Date(iso);
        return isNaN(d.getTime()) ? "" : Qt.formatDateTime(d, "ddd HH:mm");
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

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        // --- Quick add ---------------------------------------------------
        RowLayout {
            Layout.fillWidth: true
            Layout.margins: Kirigami.Units.smallSpacing
            spacing: Kirigami.Units.smallSpacing

            QQC2.TextField {
                id: addField
                Layout.fillWidth: true
                placeholderText: i18n("Add a task and press Enter…")
                onAccepted: page.submitAdd()
            }
            QQC2.ToolButton {
                icon.name: "list-add"
                display: QQC2.AbstractButton.IconOnly
                text: i18n("Add task")
                onClicked: page.submitAdd()
            }
            QQC2.BusyIndicator {
                id: busyIndicator
                running: false
                Layout.preferredHeight: addField.height
                Layout.preferredWidth: addField.height
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

                Kirigami.PlaceholderMessage {
                    anchors.centerIn: parent
                    width: parent.width - Kirigami.Units.gridUnit * 4
                    visible: list.count === 0
                    icon.name: "checkmark"
                    text: i18n("No tasks")
                    explanation: i18n("Add one above to get started.")
                }

                delegate: QQC2.ItemDelegate {
                    id: row
                    width: ListView.view.width
                    hoverEnabled: true

                    contentItem: RowLayout {
                        spacing: Kirigami.Units.smallSpacing

                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 0
                            QQC2.Label {
                                Layout.fillWidth: true
                                text: model.title
                                elide: Text.ElideRight
                            }
                            RowLayout {
                                spacing: Kirigami.Units.smallSpacing
                                visible: model.isScheduled
                                Kirigami.Icon {
                                    source: "clock"
                                    Layout.preferredWidth: Kirigami.Units.iconSizes.small
                                    Layout.preferredHeight: Kirigami.Units.iconSizes.small
                                }
                                QQC2.Label {
                                    text: model.endTime
                                          ? page.fmtTime(model.startTime) + " – " + page.fmtTime(model.endTime)
                                          : page.fmtTime(model.startTime)
                                    font: Kirigami.Theme.smallFont
                                    opacity: 0.8
                                }
                            }
                        }

                        // Tag chip
                        Rectangle {
                            visible: model.tag && model.tag.length > 0
                            radius: height / 2
                            color: page.tagColor(model.tag)
                            implicitHeight: tagLabel.implicitHeight + Kirigami.Units.smallSpacing
                            implicitWidth: tagLabel.implicitWidth + Kirigami.Units.largeSpacing
                            QQC2.Label {
                                id: tagLabel
                                anchors.centerIn: parent
                                text: model.tag
                                color: "white"
                                font: Kirigami.Theme.smallFont
                            }
                        }

                        QQC2.ToolButton {
                            icon.name: "checkmark"
                            opacity: row.hovered ? 1 : 0.35
                            QQC2.ToolTip.text: i18n("Complete")
                            QQC2.ToolTip.visible: hovered
                            QQC2.ToolTip.delay: 500
                            onClicked: taskApi.completeTask(model.taskId)
                        }
                        QQC2.ToolButton {
                            icon.name: "edit-delete"
                            opacity: row.hovered ? 1 : 0.35
                            QQC2.ToolTip.text: i18n("Delete")
                            QQC2.ToolTip.visible: hovered
                            QQC2.ToolTip.delay: 500
                            onClicked: taskApi.deleteTask(model.taskId)
                        }
                    }
                }
            }
        }
    }

    function submitAdd() {
        var t = addField.text;
        if (t && t.trim().length > 0) {
            taskApi.createTask(t, "");
            addField.text = "";
        }
    }
}
