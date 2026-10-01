from aiogram.fsm.state import State, StatesGroup


class CreateTask(StatesGroup):
    kind = State()
    title = State()
    priority = State()
    deadline = State()
    weekdays = State()
