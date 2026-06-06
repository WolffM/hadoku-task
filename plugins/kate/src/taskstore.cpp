#include "taskstore.h"

TaskStore::TaskStore(QObject *parent)
    : QAbstractListModel(parent)
{
}

int TaskStore::rowCount(const QModelIndex &parent) const
{
    if (parent.isValid())
        return 0;
    return m_tasks.size();
}

QVariant TaskStore::data(const QModelIndex &index, int role) const
{
    if (!index.isValid() || index.row() < 0 || index.row() >= m_tasks.size())
        return {};

    const Task &t = m_tasks.at(index.row());
    switch (role) {
    case IdRole:
        return t.id;
    case TitleRole:
        return t.title;
    case TagRole:
        return t.tag;
    case StateRole:
        return t.state;
    case StartTimeRole:
        return t.startTime;
    case EndTimeRole:
        return t.endTime;
    case IsScheduledRole:
        return t.isScheduled();
    default:
        return {};
    }
}

QHash<int, QByteArray> TaskStore::roleNames() const
{
    return {
        {IdRole, "taskId"},
        {TitleRole, "title"},
        {TagRole, "tag"},
        {StateRole, "state"},
        {StartTimeRole, "startTime"},
        {EndTimeRole, "endTime"},
        {IsScheduledRole, "isScheduled"},
    };
}

void TaskStore::setTasks(const QVector<Task> &tasks)
{
    beginResetModel();
    m_tasks = tasks;
    endResetModel();
    Q_EMIT countChanged();
}
