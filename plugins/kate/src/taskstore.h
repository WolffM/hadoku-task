#pragma once

#include "domain.h"

#include <QAbstractListModel>
#include <QVector>

/**
 * List model backing the Tasks tool view. Exposed to QML as `taskStore`.
 */
class TaskStore : public QAbstractListModel
{
    Q_OBJECT
    Q_PROPERTY(int count READ count NOTIFY countChanged)
    // When set, only tasks carrying this tag are shown. Empty = show all.
    Q_PROPERTY(QString filterTag READ filterTag WRITE setFilterTag NOTIFY filterTagChanged)

public:
    enum Roles {
        IdRole = Qt::UserRole + 1,
        TitleRole,
        TagRole,
        StateRole,
        StartTimeRole,
        EndTimeRole,
        IsScheduledRole
    };

    explicit TaskStore(QObject *parent = nullptr);

    int rowCount(const QModelIndex &parent = QModelIndex()) const override;
    QVariant data(const QModelIndex &index, int role) const override;
    QHash<int, QByteArray> roleNames() const override;

    int count() const { return m_view.size(); }
    void setTasks(const QVector<Task> &tasks);

    QString filterTag() const { return m_filterTag; }
    void setFilterTag(const QString &tag);

Q_SIGNALS:
    void countChanged();
    void filterTagChanged();

private:
    void applyFilter();

    QVector<Task> m_all;  // everything from the API
    QVector<Task> m_view; // filtered subset shown by the model
    QString m_filterTag;
};
