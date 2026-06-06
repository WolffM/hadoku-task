#pragma once

#include <KTextEditor/Plugin>

#include <QObject>
#include <QVariantList>

namespace KTextEditor
{
class MainWindow;
}

/**
 * Entry point for the Hadoku Tasks Kate plugin.
 *
 * One global instance per Kate process. KTextEditor calls createView() once per
 * main window; the returned TaskPluginView owns the Tasks + Calendar tool views.
 */
class TaskPlugin : public KTextEditor::Plugin
{
    Q_OBJECT

public:
    explicit TaskPlugin(QObject *parent = nullptr, const QVariantList &args = QVariantList());
    ~TaskPlugin() override;

    QObject *createView(KTextEditor::MainWindow *mainWindow) override;
};
