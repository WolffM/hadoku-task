#include "taskstore.h"

TaskStore::TaskStore(QObject *parent)
    : QAbstractListModel(parent)
{
}

int TaskStore::rowCount(const QModelIndex &parent) const
{
    if (parent.isValid())
        return 0;
    return m_view.size();
}

QVariant TaskStore::data(const QModelIndex &index, int role) const
{
    if (!index.isValid() || index.row() < 0 || index.row() >= m_view.size())
        return {};

    const Task &t = m_view.at(index.row());
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

void TaskStore::applyFilter()
{
    beginResetModel();
    if (m_filterTag.isEmpty()) {
        m_view = m_all;
    } else {
        m_view.clear();
        for (const Task &t : m_all) {
            const QStringList tags = t.tag.split(QLatin1Char(' '), Qt::SkipEmptyParts);
            if (tags.contains(m_filterTag))
                m_view.push_back(t);
        }
    }
    endResetModel();
    Q_EMIT countChanged();
}

void TaskStore::setTasks(const QVector<Task> &tasks)
{
    m_all = tasks;
    applyFilter();
}

void TaskStore::setFilterTag(const QString &tag)
{
    if (tag == m_filterTag)
        return;
    m_filterTag = tag;
    Q_EMIT filterTagChanged();
    applyFilter();
}
