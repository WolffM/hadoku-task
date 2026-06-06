#pragma once

#include "domain.h"

#include <QHash>
#include <QList>
#include <QObject>
#include <QString>
#include <QStringList>
#include <QVariantList>
#include <QVector>

#include <functional>

class QNetworkAccessManager;
class QNetworkReply;
class QNetworkRequest;

/**
 * Thin typed wrapper over the hadoku task REST API. Exposed to QML as `taskApi`.
 *
 * Auth (Phase 2): sends the raw user key as `X-User-Key` straight to the
 * hadoku.me task API — the edge-router validates it and stamps the worker.
 *
 * Concurrency: holds the board `version` from the last GET and sends it as
 * `If-Match` on writes; a 409 triggers a refetch (resync) rather than a clobber.
 */
class TaskApiClient : public QObject
{
    Q_OBJECT
    // Board list for the selector: [{ id, name }, ...].
    Q_PROPERTY(QVariantList boards READ boards NOTIFY boardsChanged)
    Q_PROPERTY(QString currentBoardId READ currentBoardId NOTIFY currentBoardIdChanged)
    // Active tag filter, shared across the Tasks and Calendar tabs.
    Q_PROPERTY(QString filterTag READ filterTag WRITE setFilterTag NOTIFY filterTagChanged)
    // Union of the current board's persistent tags + tags in use on its tasks.
    Q_PROPERTY(QStringList allTags READ allTags NOTIFY allTagsChanged)
    // Flat task list (list of maps) for views that need to iterate/group in QML
    // (the Calendar agenda). Mirrors the same data the TaskStore model holds.
    Q_PROPERTY(QVariantList tasks READ tasksList NOTIFY tasksListChanged)

public:
    explicit TaskApiClient(QObject *parent = nullptr);

    void setBaseUrl(const QString &baseUrl);
    void setCredential(const QString &userKey);
    int version() const { return m_version; }

    QVariantList boards() const { return m_boards; }
    QString currentBoardId() const { return m_boardId; }
    QString filterTag() const { return m_filterTag; }
    void setFilterTag(const QString &tag);
    QStringList allTags() const { return m_allTags; }
    QVariantList tasksList() const;

    // Invokable from QML.
    Q_INVOKABLE void fetchBoards();
    Q_INVOKABLE void fetchTasks();
    Q_INVOKABLE void reload(); // re-sync boards + tasks from the API
    Q_INVOKABLE void changeKey(const QString &userKey); // swap credential + reload
    Q_INVOKABLE void switchBoard(const QString &boardId);
    Q_INVOKABLE void createBoard(const QString &name);
    Q_INVOKABLE void createTask(const QString &input); // supports inline "#tag"s
    // Calendar create: all-day (date only) or timed (startTime/endTime). Empty
    // strings are omitted from the request.
    Q_INVOKABLE void createScheduledTask(const QString &title, const QString &date,
                                         const QString &startTime, const QString &endTime);
    Q_INVOKABLE void completeTask(const QString &id);
    Q_INVOKABLE void deleteTask(const QString &id);
    Q_INVOKABLE void setTaskTags(const QString &id, const QString &spaceSeparatedTags);
    // Tag deltas computed against the authoritative local cache (queue-safe under
    // rapid edits, unlike recomputing a full tag string in the UI).
    Q_INVOKABLE void addTaskTag(const QString &id, const QString &tag);
    Q_INVOKABLE void removeTaskTag(const QString &id, const QString &tag);
    // Remove a tag from every task on the board and from the board's tag list.
    Q_INVOKABLE void clearTagEverywhere(const QString &tag);

    // Lets QML write into the same log file (UI-side diagnostics).
    Q_INVOKABLE void logUi(const QString &message) const;

Q_SIGNALS:
    void tasksReceived(const QVector<Task> &tasks, int version);
    void boardsChanged();
    void currentBoardIdChanged();
    void filterTagChanged();
    void allTagsChanged();
    void tasksListChanged();
    void busyChanged(bool busy);
    void errorOccurred(const QString &message);

private:
    QNetworkRequest makeRequest(const QString &url, bool withIfMatch) const;
    void recomputeTaskTags(const QVector<Task> &tasks);
    void recomputeAllTags();
    int taskIndex(const QString &id) const;
    void optimisticEmit();
    void enqueueWrite(const QString &label, std::function<QNetworkReply *()> builder);
    void runNextWrite();

    // One serialized write at a time so rapid edits never race the board version.
    struct PendingWrite {
        QString label;
        std::function<QNetworkReply *()> builder;
    };
    QList<PendingWrite> m_writeQueue;
    bool m_processing = false;

    QNetworkAccessManager *m_nam;
    QString m_baseUrl = QStringLiteral("https://hadoku.me/task/api");
    QString m_key;
    QString m_boardId = QStringLiteral("main");
    QString m_filterTag;
    int m_version = 0;

    QVector<Task> m_tasks;                  // last fetched tasks for the current board
    QVariantList m_boards;                  // [{id,name}]
    QHash<QString, QStringList> m_boardTags; // boardId -> persistent tags
    QStringList m_taskTags;                  // tags seen on current board's tasks
    QStringList m_allTags;                   // union, for filter chips
};
